import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { describeSshFailure, sshArgs, sshTransport, type SshProcess } from './ssh'

class FakeSsh extends EventEmitter implements SshProcess {
  readonly stderr = new EventEmitter()
  readonly signals: string[] = []

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    queueMicrotask(() => this.emit('exit', null, signal ?? 'SIGTERM'))
    return true
  }

  fail(stderr: string, code = 255): void {
    this.stderr.emit('data', Buffer.from(stderr))
    this.emit('exit', code, null)
  }
}

function setup({ readyAfter = 0 }: { readyAfter?: number } = {}) {
  const spawned: { command: string; args: readonly string[]; process: FakeSsh }[] = []
  let probes = 0
  const transport = sshTransport(
    { kind: 'ssh', host: 'bastion' },
    {
      spawn: (command, args) => {
        const process = new FakeSsh()
        spawned.push({ command, args, process })
        return process
      },
      freePort: () => Promise.resolve(40_000 + spawned.length),
      probe: () => Promise.resolve(++probes > readyAfter),
      pollMs: 1,
      timeoutMs: 200,
    },
  )
  return { transport, spawned }
}

const target = { host: '10.0.12.7', port: 5432 }

describe('sshArgs', () => {
  it('forwards a local port to the target through an alias, without prompts', () => {
    const args = sshArgs({ kind: 'ssh', host: 'bastion-eu' }, 40_001, target)
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('ExitOnForwardFailure=yes')
    expect(args.slice(args.indexOf('-L'), args.indexOf('-L') + 2)).toEqual([
      '-L',
      '127.0.0.1:40001:10.0.12.7:5432',
    ])
    expect(args.slice(-2)).toEqual(['--', 'bastion-eu'])
    expect(args).not.toContain('-i')
  })

  it('splits user@host:port and passes the identity file', () => {
    const args = sshArgs(
      { kind: 'ssh', host: 'deploy@bastion.example.com:2222', identityFile: '/keys/id' },
      1,
      { host: '::1', port: 5432 },
    )
    expect(args).toContain('127.0.0.1:1:[::1]:5432')
    expect(args.join(' ')).toContain('-i /keys/id -o IdentitiesOnly=yes -p 2222 -l deploy')
    expect(args.slice(-2)).toEqual(['--', 'bastion.example.com'])
  })

  it('refuses a host that would pass for an option', () => {
    expect(() => sshArgs({ kind: 'ssh', host: '-oProxyCommand=x' }, 1, target)).toThrow()
  })
})

describe('sshTransport', () => {
  it('returns the local endpoint once the port accepts, and stops ssh on close', async () => {
    const { transport, spawned } = setup({ readyAfter: 3 })
    const tunnel = await transport.open(target)
    expect(tunnel.endpoint).toEqual({ host: '127.0.0.1', port: 40_000 })
    expect(spawned[0]?.command).toBe('ssh')
    await tunnel.close()
    expect(spawned[0]?.process.signals).toEqual(['SIGTERM'])
  })

  it('reports why ssh exited before the tunnel came up', async () => {
    const { transport, spawned } = setup({ readyAfter: Infinity })
    const opening = transport.open(target)
    await new Promise((resolve) => setTimeout(resolve, 5))
    spawned[0]?.process.fail('deploy@bastion: Permission denied (publickey).\n')
    await expect(opening).rejects.toThrow(/refused the key/)
  })

  it('retries once when the local port was taken meanwhile', async () => {
    const { transport, spawned } = setup({ readyAfter: Infinity })
    const opening = transport.open(target)
    await new Promise((resolve) => setTimeout(resolve, 5))
    spawned[0]?.process.fail('bind [127.0.0.1]:40001: Address already in use\n')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(spawned).toHaveLength(2)
    spawned[1]?.process.fail('ssh: Could not resolve hostname bastion: nodename nor servname\n')
    await expect(opening).rejects.toThrow(/Unknown SSH host "bastion"/)
  })

  it('gives up and kills ssh after the timeout', async () => {
    const { transport, spawned } = setup({ readyAfter: Infinity })
    await expect(transport.open(target)).rejects.toThrow(/did not come up/)
    expect(spawned[0]?.process.signals).toEqual(['SIGTERM'])
  })

  it('says ssh is missing when it cannot be started', async () => {
    const { transport, spawned } = setup({ readyAfter: Infinity })
    const opening = transport.open(target)
    await new Promise((resolve) => setTimeout(resolve, 5))
    spawned[0]?.process.emit(
      'error',
      Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' }),
    )
    await expect(opening).rejects.toThrow(/not installed/)
  })

  it('explains a forward the server could not open', async () => {
    const { transport, spawned } = setup()
    const tunnel = await transport.open(target)
    spawned[0]?.process.stderr.emit(
      'data',
      'channel 2: open failed: connect failed: Connection refused\n',
    )
    expect(tunnel.failure?.()).toBe(
      'The SSH server could not reach 10.0.12.7:5432: Connection refused.',
    )
  })
})

describe('describeSshFailure', () => {
  const config = { kind: 'ssh' as const, host: 'bastion-eu' }
  it.each([
    ['Host key verification failed.', /not trusted yet. Run "ssh bastion-eu"/],
    ['ssh: connect to host 1.2.3.4 port 22: Operation timed out', /timed out/],
    ['ssh: connect to host 1.2.3.4 port 22: Connection refused', /refused the SSH connection/],
    [
      'Warning: Identity file /nope not accessible: No such file or directory.',
      /\/nope does not exist/,
    ],
    ["Permissions 0644 for '/k' are too open.\nbad permissions: ignore key: /k", /chmod 600/],
    ['something odd happened', /failed: something odd happened/],
    ['', /exited without a message/],
  ])('%s', (stderr, expected) => {
    expect(describeSshFailure(stderr, config)).toMatch(expected)
  })
})
