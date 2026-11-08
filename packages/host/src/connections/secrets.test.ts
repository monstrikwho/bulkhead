import { describe, expect, it } from 'vitest'

import { MemorySecrets } from '../testing'
import { SecretVault } from './secrets'

describe('SecretVault', () => {
  it('keeps the key format existing installs stored passwords under', async () => {
    const store = new MemorySecrets()
    const vault = new SecretVault(store)
    await vault.set('abc', 'password', 's3cret')
    expect([...store.values]).toEqual([['bulkhead.connection.abc.password', 's3cret']])
    expect(await vault.get('abc', 'password')).toBe('s3cret')
    expect(await vault.get('other', 'password')).toBeUndefined()
  })

  it('deletes every secret field of a profile and nothing else', async () => {
    const store = new MemorySecrets()
    const vault = new SecretVault(store)
    await vault.set('abc', 'password', 'a')
    await vault.set('abc', 'key', 'b')
    await vault.set('xyz', 'password', 'c')
    await vault.deleteAll('abc', [
      { key: 'password', label: 'Password' },
      { key: 'key', label: 'Key' },
    ])
    expect([...store.values.keys()]).toEqual(['bulkhead.connection.xyz.password'])
  })
})
