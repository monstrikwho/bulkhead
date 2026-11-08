import { describe, expect, it } from 'vitest'

import { readProfiles } from './profiles'

describe('readProfiles', () => {
  it('keeps valid entries and reports broken ones by name or position', () => {
    const { profiles, invalid } = readProfiles([
      { id: 'a', name: 'shop', driver: 'postgres' },
      { id: 'b', name: 'legacy', driver: 'oracle' },
      null,
    ])
    expect(profiles.map((profile) => profile.id)).toEqual(['a'])
    expect(profiles[0]).toMatchObject({ production: false, transport: { kind: 'direct' } })
    expect(invalid.map(({ index, name }) => ({ index, name }))).toEqual([
      { index: 1, name: 'legacy' },
      { index: 2, name: '#3' },
    ])
  })
})
