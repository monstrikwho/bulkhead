import { describe, expect, it } from 'vitest'

import { toJson } from './json'

describe('toJson', () => {
  it('drops keys holding undefined, the reason Orca refused tree nodes', () => {
    const nodes = [
      { id: 'v', kind: 'view', label: 'active_users', description: undefined },
      { id: 't', kind: 'table', label: 'orders', description: '~1.2k rows' },
    ]
    const json = toJson(nodes)
    expect(json).toEqual([
      { id: 'v', kind: 'view', label: 'active_users' },
      { id: 't', kind: 'table', label: 'orders', description: '~1.2k rows' },
    ])
    expect(Object.keys((json as Record<string, unknown>[])[0]!)).not.toContain('description')
  })

  it('keeps arrays aligned and turns a bare undefined into null', () => {
    expect(toJson([1, undefined, 'a'])).toEqual([1, null, 'a'])
    expect(toJson(undefined)).toBeNull()
    expect(toJson({ ok: true, value: undefined })).toEqual({ ok: true })
  })
})
