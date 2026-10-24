/**
 * Screenshots of the webviews in every state worth looking at, in a dark and a light theme, without
 * starting VS Code: `pnpm preview:webview [filter]` → `.preview/<scenario>-<theme>.png`.
 *
 * The page loads the real webview bundle and a mock host (scripts/preview/mockHost.js) that
 * answers its messages. Headless system Chrome via playwright-core: nothing pops up on screen.
 * Exits with 1 when a page logs an error.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { themeCss } from './preview/themes.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'packages/extension/dist/webview')
const out = join(root, '.preview')
const filter = process.argv[2] ?? ''

// esbuild is a dependency of the extension package; pnpm does not hoist it to the root.
const esbuild = createRequire(join(root, 'packages/extension/package.json'))('esbuild')

const NEON_URL =
  'postgres://neondb_owner:secret@ep-cool-darkness-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require'

const columns = [
  { name: 'id', type: 'bigint', numeric: true },
  { name: 'email', type: 'text' },
  { name: 'name', type: 'text' },
  { name: 'total', type: 'numeric(12,2)', numeric: true },
  { name: 'paid', type: 'boolean' },
  { name: 'placed_at', type: 'timestamp with time zone' },
]
const rows = Array.from({ length: 1000 }, (_, i) => [
  String(i + 1),
  `user${i}@example.com`,
  i % 7 ? `User ${i}` : null,
  ((i * 13.37) % 500).toFixed(2),
  i % 3 === 0,
  `2026-10-2${i % 9} 10:0${i % 10}:00+00`,
])
const run = (connection, outcomes) => [
  { type: 'run-started', runId: 'r', connection, script: '…', startedAt: 0 },
  { type: 'run-finished', runId: 'r', outcomes, finishedAt: 42 },
]

/** name → page setup and the steps to reach the state. */
const SCENARIOS = {
  'results-grid': {
    app: 'results',
    viewport: { width: 1100, height: 420 },
    results: run({ name: 'local', database: 'shop', production: false, accessMode: 'read-write' }, [
      {
        kind: 'rows',
        statement: 'select * from shop.orders',
        columns,
        rows,
        truncated: true,
        durationMs: 42,
      },
    ]),
    steps: (page) => page.waitForSelector('.grid-row'),
  },
  'results-blocked-prod': {
    app: 'results',
    viewport: { width: 1100, height: 420 },
    results: run(
      { name: 'orders-prod', database: 'shop', production: true, accessMode: 'read-only' },
      [
        {
          kind: 'rows',
          statement: 'select 1',
          columns,
          rows: rows.slice(0, 3),
          truncated: false,
          durationMs: 3,
        },
        {
          kind: 'error',
          statement: 'delete from shop.orders where id = 1',
          message: 'Blocked by read-only mode: DELETE — only read statements are allowed.',
          blockedBy: 'guard',
          durationMs: 0,
        },
      ],
    ),
    steps: (page) => page.waitForSelector('.error-box'),
  },
  'form-picker': {
    app: 'connection-form',
    steps: (page) => page.waitForSelector('.cf-tile'),
  },
  'form-pasted-url': {
    app: 'connection-form',
    steps: async (page) => {
      await page.fill('.cf-search input', NEON_URL)
      await page.waitForSelector('.cf-hint.ok')
    },
  },
  'form-neon-tested': {
    app: 'connection-form',
    steps: async (page) => {
      await page.fill('.cf-search input', NEON_URL)
      await page.waitForSelector('.cf-hint.ok')
      await page.keyboard.press('Enter')
      await page.click('text=Test')
      await page.waitForSelector('.cf-test')
    },
  },
  'form-production-invalid': {
    app: 'connection-form',
    steps: async (page) => {
      await page.fill('.cf-search input', 'aws')
      await page.click('.cf-tile')
      await page.click('[role=radio]:has-text("Production")')
      await page.click('.cf-disclosure')
      await page.click('text=Save connection')
      await page.waitForTimeout(200)
    },
  },
  'form-edit-refused': {
    app: 'connection-form',
    start: {
      draft: {
        id: 'x',
        name: 'orders-prod',
        driver: 'postgres',
        production: true,
        readOnly: false,
        options: {
          host: 'orders.db.internal',
          port: 5432,
          user: 'reader',
          database: 'shop',
          ssl: 'verify-full',
        },
        secrets: {},
      },
      savedSecrets: ['password'],
    },
    steps: async (page) => {
      await page.fill('.cf-host input >> nth=0', 'nowhere')
      await page.click('text=Test')
      await page.waitForSelector('.cf-test')
    },
  },
  'form-agent-new': {
    app: 'connection-form',
    start: {
      draft: {
        name: 'shop (staging)',
        driver: 'postgres',
        production: false,
        readOnly: false,
        options: {
          host: 'staging.db.internal',
          port: 5432,
          user: 'app',
          database: 'shop',
          ssl: 'require',
        },
        secrets: {},
      },
      savedSecrets: [],
      proposal: { changed: [], warnings: [] },
    },
    steps: (page) => page.waitForSelector('.cf-agent'),
  },
  'form-agent-prod-off': {
    app: 'connection-form',
    start: {
      draft: {
        id: 'x',
        name: 'orders-prod',
        driver: 'postgres',
        production: false,
        readOnly: false,
        options: {
          host: 'orders.db.internal',
          port: 5432,
          user: 'writer',
          database: 'shop',
          ssl: 'verify-full',
        },
        secrets: {},
      },
      savedSecrets: ['password'],
      proposal: {
        changed: ['Environment', 'Read-only', 'User'],
        warnings: ['Turns off Production: writes will no longer be blocked.'],
      },
    },
    steps: (page) => page.waitForSelector('.cf-agent.danger'),
  },
}

execSync('pnpm --filter @bulkhead/webview build', { cwd: root, stdio: 'ignore' })
const mock = (
  await esbuild.build({
    entryPoints: [join(root, 'scripts/preview/mockHost.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'error',
  })
).outputFiles[0].text

const page = (name, theme) => {
  const { app, results, start } = SCENARIOS[name]
  const data = { app, results, start }
  return `<!doctype html>
<html><head><meta charset="utf-8" /><link rel="icon" href="data:," />
<style>${themeCss(theme)}</style>
<link rel="stylesheet" href="/index.css" /></head>
<body data-app="${data.app}"><div id="root"></div>
<script>window.__PREVIEW__ = ${JSON.stringify(data)}</script>
<script src="/mock.js"></script>
<script type="module" src="/index.js"></script></body></html>`
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(page(url.searchParams.get('scenario'), url.searchParams.get('theme')))
  } else if (url.pathname === '/mock.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' })
    response.end(mock)
  } else {
    const types = { '.js': 'text/javascript', '.css': 'text/css' }
    const file = url.pathname.slice(1)
    if (!existsSync(join(dist, file))) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'text/plain',
    })
    response.end(readFileSync(join(dist, file)))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/`

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
} catch (error) {
  process.stderr.write(
    `Needs Google Chrome installed (playwright-core uses the system browser).\n${error}`,
  )
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const errors = []
for (const name of Object.keys(SCENARIOS).filter((key) => key.includes(filter))) {
  for (const theme of ['dark', 'light']) {
    const tab = await browser.newPage({
      viewport: SCENARIOS[name].viewport ?? { width: 1100, height: 900 },
    })
    tab.on('pageerror', (error) => errors.push(`${name}/${theme}: ${error.message}`))
    tab.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${name}/${theme}: ${message.text()}`)
    })
    await tab.goto(`${base}?scenario=${name}&theme=${theme}`)
    await SCENARIOS[name].steps(tab)
    const file = join(out, `${name}-${theme}.png`)
    await tab.screenshot({ path: file, fullPage: true })
    process.stdout.write(`${file}\n`)
    await tab.close()
  }
}
await browser.close()
server.close()

if (errors.length) {
  process.stderr.write(`\nPage errors:\n${errors.join('\n')}\n`)
  process.exit(1)
}
