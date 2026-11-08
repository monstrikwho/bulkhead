// Builds the Orca plugin folder, packages/orca/dist: the manifest, the worker and the MCP bridge
// bundled with esbuild (no node_modules: Orca plugins hold at most 2,000 files and 50 MiB), and
// the webview bundle as the panel. `--production` minifies.
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const production = process.argv.includes('--production')
const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(here, '..', '..')
const dist = join(here, 'dist')
// One version for both hosts: the extension's.
const { version } = JSON.parse(readFileSync(join(root, 'packages/extension/package.json'), 'utf8'))

rmSync(dist, { recursive: true, force: true })
mkdirSync(join(dist, 'panel'), { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  // Orca runs workers on its own Node (24 in Orca 1.4.253).
  target: 'node22',
  // An optional native binding pg never loads unless asked to.
  external: ['pg-native'],
  minify: production,
  sourcemap: false,
  logLevel: 'warning',
  legalComments: 'none',
}

await esbuild.build({
  ...common,
  entryPoints: [join(here, 'src/worker.ts')],
  outfile: join(dist, 'worker.mjs'),
  format: 'esm',
  define: { BULKHEAD_VERSION: JSON.stringify(version) },
  // CommonJS dependencies (pg) call require(); give the ES module one.
  banner: {
    js: "import { createRequire as __bulkheadRequire } from 'node:module'; const require = __bulkheadRequire(import.meta.url);",
  },
})

// The stdio bridge agents start; CommonJS, because it finds its instances through __dirname.
await esbuild.build({
  ...common,
  entryPoints: [join(root, 'packages/host/src/mcp/bridge.ts')],
  outfile: join(dist, 'mcp-bridge.js'),
  format: 'cjs',
  sourcemap: false,
})

execFileSync('pnpm', ['--filter', '@bulkhead/webview', 'build'], { cwd: root, stdio: 'inherit' })
const webview = join(root, 'packages/extension/dist/webview')
for (const file of ['index.js', 'index.css'])
  copyFileSync(join(webview, file), join(dist, 'panel', file))
// The sidebar panel and the two editor tabs (console, table) share the bundle.
for (const page of ['index.html', 'console.html', 'table.html'])
  copyFileSync(join(here, 'panel', page), join(dist, 'panel', page))
copyFileSync(join(root, 'LICENSE'), join(dist, 'LICENSE'))

const manifest = JSON.parse(readFileSync(join(here, 'orca-plugin.json'), 'utf8'))
writeFileSync(
  join(dist, 'orca-plugin.json'),
  `${JSON.stringify({ ...manifest, version }, null, 2)}\n`,
)

let files = 0
let bytes = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) walk(path)
    else {
      files += 1
      bytes += stats.size
    }
  }
}
walk(dist)
if (files > 2000 || bytes > 50 * 1024 * 1024)
  throw new Error(`dist too large: ${files} files, ${bytes} bytes`)
// eslint-disable-next-line no-console
console.log(
  `orca plugin ${version}: ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB in ${dist}`,
)
