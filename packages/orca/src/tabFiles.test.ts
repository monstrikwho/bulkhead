import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { parseConnectionProfile, parseConsoleFile, parseTableFile } from '@bulkhead/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OrcaWorker } from './orcaApi'
import {
  consoleFile,
  fileName,
  findWorkspace,
  orcaCli,
  tableFile,
  tabsWorkspace,
  type Workspace,
} from './tabFiles'

describe('tabsWorkspace', () => {
  let folder: string
  beforeEach(async () => {
    folder = join(await mkdtemp(join(tmpdir(), 'bulkhead-ws-')), 'Bulkhead')
  })
  afterEach(() => rm(dirname(folder), { recursive: true, force: true }))

  const orca = (workspaces: { id: string; path: string; hostId: string | null }[]) => ({
    call: (method: string) => {
      expect(method).toBe('workspace.list')
      return Promise.resolve({ workspaces, truncated: false })
    },
  })

  it('reuses the workspace already on the folder', async () => {
    await mkdir(folder, { recursive: true })
    const path = await realpath(folder)
    const added: string[] = []
    const host = orca([
      { id: 'other', path: '/work/app', hostId: 'local' },
      { id: 'mine', path, hostId: 'local' },
    ]) as unknown as OrcaWorker['host']
    expect(await tabsWorkspace(host, folder, (p) => Promise.resolve(void added.push(p)))).toEqual({
      id: 'mine',
      path,
    })
    expect(added).toEqual([])
  })

  it('adds the folder once when Orca does not have it yet', async () => {
    const workspaces: { id: string; path: string; hostId: string | null }[] = [
      { id: 'other', path: '/work/app', hostId: 'local' },
    ]
    const added: string[] = []
    const host = orca(workspaces) as unknown as OrcaWorker['host']
    const workspace = await tabsWorkspace(
      host,
      folder,
      (path) => {
        added.push(path)
        workspaces.push({ id: 'new', path, hostId: 'local' })
        return Promise.resolve()
      },
      () => Promise.resolve(),
    )
    expect(workspace.id).toBe('new')
    expect(added).toEqual([await realpath(folder)])
  })

  it('ignores a workspace on another host with the same path', () => {
    expect(findWorkspace([{ id: 'r', path: '/a/Bulkhead', hostId: 'ssh-1' }], '/a/Bulkhead')).toBe(
      undefined,
    )
    expect(findWorkspace([{ id: 'l', path: '/a/Bulkhead/', hostId: null }], '/a/Bulkhead')).toEqual(
      { id: 'l', path: '/a/Bulkhead' },
    )
  })

  it('finds the CLI in the app bundle the worker runs from', () => {
    expect(
      orcaCli(
        '/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper',
      ),
    ).toBe('/Applications/Orca.app/Contents/Resources/bin/orca')
    expect(orcaCli('/usr/lib/orca/orca')).toBe('orca')
  })
})

describe('fileName', () => {
  it('keeps names readable and drops what a file system refuses', () => {
    expect(fileName('Orders prod (read-only)')).toBe('Orders prod (read-only)')
    expect(fileName('a/b:c')).toBe('a_b_c')
    expect(fileName('..')).toBe('connection')
    expect(fileName('заказы')).toBe('заказы')
  })
})

describe('tab files', () => {
  let workspace: Workspace
  const profile = parseConnectionProfile({
    id: '0fe2d30e-5f40-46e5-add9-c03c2c72ffd9',
    name: 'orders',
    driver: 'postgres',
    production: true,
    options: { host: 'db', database: 'shop', user: 'reader' },
  })

  beforeEach(async () => {
    workspace = { id: 'w', path: await mkdtemp(join(tmpdir(), 'bulkhead-tabs-')) }
  })
  afterEach(() => rm(workspace.path, { recursive: true, force: true }))

  it('creates a console once and keeps what the user wrote', async () => {
    const path = await consoleFile(workspace, profile)
    expect(path).toBe('orders.bhsql')
    const full = join(workspace.path, path)
    expect(parseConsoleFile(await readFile(full, 'utf8'))).toEqual({
      connectionId: profile.id,
      sql: '',
    })
    await writeFile(full, `-- bulkhead connection: ${profile.id}\nselect 1;\n`)
    expect(await consoleFile(workspace, profile)).toBe(path)
    expect(await readFile(full, 'utf8')).toContain('select 1;')
  })

  it('gives a second connection with the same name its own console', async () => {
    await consoleFile(workspace, profile)
    const other = { ...profile, id: '9a8b7c6d-0000-4000-8000-000000000000' }
    expect(await consoleFile(workspace, other)).toBe('orders-9a8b7c6d.bhsql')
  })

  it('writes what a table tab shows, and nothing secret', async () => {
    const path = await tableFile(workspace, profile, {
      id: 'db:shop/rel:1',
      kind: 'table',
      label: 'customers',
      expandable: true,
      database: 'shop',
      previewQuery: 'SELECT "id" FROM "public"."customers"',
      previewNotice: '2 columns hidden: no SELECT privilege.',
      context: { schema: 'public', oid: '1' },
    })
    expect(path).toBe('tables/orders-0fe2d30e/shop/public.customers (orders).bhtable')
    const text = await readFile(join(workspace.path, path), 'utf8')
    expect(parseTableFile(text)).toEqual({
      bulkhead: 'table',
      connectionId: profile.id,
      title: 'public.customers',
      database: 'shop',
      query: 'SELECT "id" FROM "public"."customers"',
      notice: '2 columns hidden: no SELECT privilege.',
    })
  })
})
