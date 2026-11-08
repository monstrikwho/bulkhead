import { describe, expect, it } from 'vitest'

import { parseConnectionProfile, parseSshDestination, transportConfigSchema } from './connection'

describe('ssh transport', () => {
  it.each([
    ['bastion-eu', { host: 'bastion-eu' }],
    ['deploy@bastion.example.com', { user: 'deploy', host: 'bastion.example.com' }],
    ['deploy@10.0.0.1:2222', { user: 'deploy', host: '10.0.0.1', port: 2222 }],
    ['[2001:db8::1]:22', { host: '2001:db8::1', port: 22 }],
  ])('reads %s', (destination, expected) => {
    expect(parseSshDestination(destination)).toEqual(expected)
  })

  it.each(['', '-oProxyCommand=x', 'a b', 'user@-host', '-l@host', 'host:99999', 'a@b@c', 'host:'])(
    'refuses %j',
    (host) => {
      expect(transportConfigSchema.safeParse({ kind: 'ssh', host }).success).toBe(false)
    },
  )

  it('defaults old profiles without a transport to direct', () => {
    const profile = parseConnectionProfile({ id: 'a', name: 'a', driver: 'postgres' })
    expect(profile.transport).toEqual({ kind: 'direct' })
  })

  it('refuses an identity file that looks like an option', () => {
    const parsed = transportConfigSchema.safeParse({ kind: 'ssh', host: 'h', identityFile: '-F/x' })
    expect(parsed.success).toBe(false)
  })
})
