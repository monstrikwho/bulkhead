import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  chooseInstance,
  readInstances,
  removeInstance,
  writeInstance,
  type McpInstance,
} from './discovery'

const instance = (pid: number, workspaceFolders: string[], startedAt = pid): McpInstance => ({
  pid,
  port: 40000 + pid,
  token: `token-${pid}`,
  workspaceFolders,
  startedAt,
})

describe('chooseInstance', () => {
  const alive = () => true

  it('picks the deepest workspace folder containing the working directory', () => {
    const instances = [
      instance(1, ['/work']),
      instance(2, ['/work/shop', '/other']),
      instance(3, ['/work/shop-admin']),
    ]
    expect(chooseInstance(instances, '/work/shop/src', alive)?.pid).toBe(2)
    expect(chooseInstance(instances, '/work/shop', alive)?.pid).toBe(2)
    // A sibling with a common prefix is not "inside".
    expect(chooseInstance(instances, '/work/shop-admin/x', alive)?.pid).toBe(3)
    expect(chooseInstance(instances, '/work/docs', alive)?.pid).toBe(1)
  })

  it('falls back to the newest window, and skips dead ones', () => {
    const instances = [instance(1, ['/a'], 10), instance(2, [], 30), instance(3, ['/b'], 20)]
    expect(chooseInstance(instances, '/elsewhere', alive)?.pid).toBe(2)
    expect(chooseInstance(instances, '/elsewhere', (pid) => pid !== 2)?.pid).toBe(3)
    expect(chooseInstance(instances, '/a', (pid) => pid !== 1)?.pid).toBe(2)
    expect(chooseInstance([], '/a', alive)).toBeUndefined()
  })
})

describe('instance files', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips, readable by the user only, and ignores broken files', () => {
    dir = join(mkdtempSync(join(tmpdir(), 'bulkhead-mcp-')), 'instances')
    writeInstance(dir, instance(7, ['/work']))
    writeFileSync(join(dir, 'broken.json'), '{')
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ pid: 'x' }))

    expect(readInstances(dir)).toEqual([instance(7, ['/work'])])
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, '7.json')).mode & 0o777).toBe(0o600)
      expect(statSync(dir).mode & 0o777).toBe(0o700)
    }
    expect(JSON.parse(readFileSync(join(dir, '7.json'), 'utf8'))).toMatchObject({ port: 40007 })

    removeInstance(dir, 7)
    expect(readInstances(dir)).toEqual([])
  })

  it('reads nothing from a missing directory', () => {
    expect(readInstances(join(tmpdir(), 'bulkhead-does-not-exist'))).toEqual([])
  })
})
