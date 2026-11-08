import { spawn as nodeSpawn } from 'node:child_process'
import { createServer, connect as tcpConnect } from 'node:net'
import { homedir } from 'node:os'

import {
  parseSshDestination,
  type Endpoint,
  type SshTransportConfig,
  type Transport,
  type Tunnel,
} from '@bulkhead/core'

/**
 * SSH local port forwarding through the system OpenSSH client. Spawning `ssh` instead of
 * speaking the protocol ourselves means `~/.ssh/config` (aliases, `ProxyJump`, `IdentityFile`,
 * `known_hosts`) works exactly as in the user's terminal, and no SSH stack ships with Bulkhead.
 *
 * `BatchMode=yes`: ssh never prompts. There is no terminal to prompt in, and an unknown host key
 * must be accepted by the user in a terminal, not by us. Hosts without `SSH_AUTH_SOCK` (Orca
 * workers) therefore need a key ssh can read without a passphrase prompt.
 */

/** The part of `child_process.spawn` the transport uses; tests pass a fake. */
export type SpawnSsh = (command: string, args: readonly string[]) => SshProcess

export interface SshProcess {
  readonly stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export interface SshTransportOptions {
  spawn?: SpawnSsh
  /** `ssh` by default, found on `PATH`. */
  command?: string
  /** Extra arguments before the destination, e.g. `-F <config>` in tests. */
  extraArgs?: readonly string[]
  /** Local port to forward from; a free one by default. */
  freePort?: () => Promise<number>
  /** Whether something accepts on the local port yet. */
  probe?: (endpoint: Endpoint) => Promise<boolean>
  /** How long ssh may take to connect and authenticate. */
  timeoutMs?: number
  pollMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
/** ssh prints a few lines on a clean run; keep enough to explain a failure, not a log. */
const STDERR_LIMIT = 8_192

export class SshError extends Error {
  override name = 'SshError'
}

export function sshTransport(
  config: SshTransportConfig,
  options: SshTransportOptions = {},
): Transport {
  return {
    async open(target) {
      // Two tries: the free port can be taken between picking it and ssh binding it.
      try {
        return await openTunnel(config, target, options)
      } catch (error) {
        if (error instanceof PortTakenError) return openTunnel(config, target, options)
        throw error
      }
    },
  }
}

class PortTakenError extends SshError {}

/** The ssh arguments for a tunnel; exported for tests and for documentation. */
export function sshArgs(
  config: SshTransportConfig,
  localPort: number,
  target: Endpoint,
  extraArgs: readonly string[] = [],
): string[] {
  const destination = parseSshDestination(config.host)
  if (!destination) throw new SshError(`SSH host "${config.host}" is not a host or alias.`)
  const remoteHost = target.host.includes(':') ? `[${target.host}]` : target.host
  const args = [
    '-N',
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-L',
    `127.0.0.1:${localPort}:${remoteHost}:${target.port}`,
  ]
  if (config.identityFile) {
    args.push('-i', expandHome(config.identityFile), '-o', 'IdentitiesOnly=yes')
  }
  if (destination.port !== undefined) args.push('-p', String(destination.port))
  if (destination.user !== undefined) args.push('-l', destination.user)
  args.push(...extraArgs, '--', destination.host)
  return args
}

async function openTunnel(
  config: SshTransportConfig,
  target: Endpoint,
  options: SshTransportOptions,
): Promise<Tunnel> {
  const spawn = options.spawn ?? defaultSpawn
  const probe = options.probe ?? acceptsConnections
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = options.pollMs ?? 100
  const port = await (options.freePort ?? freeLocalPort)()
  const endpoint = { host: '127.0.0.1', port }
  const child = spawn(options.command ?? 'ssh', sshArgs(config, port, target, options.extraArgs))

  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT)
  })
  let exited = false
  let spawnError: Error | undefined
  const exit = new Promise<void>((resolve) => {
    child.on('exit', () => {
      exited = true
      resolve()
    })
    child.on('error', (error) => {
      spawnError = error
      exited = true
      resolve()
    })
  })

  const stop = async () => {
    if (exited) return
    child.kill('SIGTERM')
    const killed = await Promise.race([exit.then(() => true), delay(2_000).then(() => false)])
    if (!killed) child.kill('SIGKILL')
  }

  const started = Date.now()
  for (;;) {
    if (exited) {
      const message = spawnError
        ? describeSpawnError(spawnError)
        : describeSshFailure(stderr, config)
      if (/cannot listen to port|Address already in use/i.test(stderr))
        throw new PortTakenError(message)
      throw new SshError(message)
    }
    // ssh opens the local listener only after it has authenticated, so a connection means the
    // tunnel is up.
    if (await probe(endpoint)) break
    if (Date.now() - started > timeoutMs) {
      await stop()
      throw new SshError(
        `SSH to ${config.host} did not come up within ${Math.round(timeoutMs / 1000)} s.` +
          suffix(lastLines(stderr)),
      )
    }
    await Promise.race([delay(pollMs), exit])
  }

  return {
    endpoint,
    failure() {
      if (exited)
        return `The SSH tunnel to ${config.host} closed.` + suffix(describeSshStderr(stderr))
      return describeChannelFailure(stderr, target)
    },
    close: stop,
  }
}

/** Turns what ssh printed before exiting into one sentence the user can act on. */
export function describeSshFailure(stderr: string, config: SshTransportConfig): string {
  const host = config.host
  const known = describeSshStderr(stderr, host)
  if (known) return known
  const detail = lastLines(stderr)
  return detail ? `SSH to ${host} failed: ${detail}` : `SSH to ${host} exited without a message.`
}

function describeSshStderr(stderr: string, host = 'the SSH server'): string | undefined {
  const text = stderr
  if (/Could not resolve hostname/i.test(text)) {
    return `Unknown SSH host "${host}": not in ~/.ssh/config and not resolvable.`
  }
  if (
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/i.test(
      text,
    )
  ) {
    return (
      `The host key of ${host} is not trusted yet. Run "ssh ${host}" once in a terminal and ` +
      'accept it; Bulkhead never accepts host keys on its own.'
    )
  }
  const keyFile =
    /(?:no such identity|Warning: Identity file) ([^:\n]+?)(?:: No such file| not accessible)/i.exec(
      text,
    )
  if (keyFile?.[1]) return `Identity file ${keyFile[1].trim()} does not exist.`
  if (/UNPROTECTED PRIVATE KEY FILE|bad permissions/i.test(text)) {
    return 'The private key is readable by other users, so ssh refuses it. Run chmod 600 on it.'
  }
  if (/Permission denied \(/i.test(text)) {
    return (
      `${host} refused the key. Set an identity file (in the form or IdentityFile in ` +
      '~/.ssh/config) that this server accepts. ssh runs without an agent and cannot ask for a ' +
      'passphrase, so the key must be usable without one.'
    )
  }
  if (/timed out/i.test(text)) return `SSH to ${host} timed out: the server did not answer.`
  if (/Connection refused/i.test(text) && !/channel \d+: open failed/i.test(text)) {
    return `${host} refused the SSH connection: no SSH server on that port.`
  }
  if (/Network is unreachable|No route to host/i.test(text)) {
    return `SSH to ${host} failed: the network cannot reach it.`
  }
  return undefined
}

/** ssh reports a forward it could not open as `channel N: open failed: …`. */
function describeChannelFailure(stderr: string, target: Endpoint): string | undefined {
  const match = /channel \d+: open failed: [^:]+: (.+)/i.exec(stderr)
  if (!match?.[1]) return undefined
  return `The SSH server could not reach ${target.host}:${target.port}: ${match[1].trim()}.`
}

function describeSpawnError(error: Error): string {
  if ((error as { code?: unknown }).code === 'ENOENT') {
    return 'The OpenSSH client (ssh) is not installed or not on PATH.'
  }
  return `Could not start ssh: ${error.message}`
}

function lastLines(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Warning: Permanently added'))
    .slice(-2)
    .join(' ')
}

function suffix(text: string | undefined): string {
  return text ? ` ${text}` : ''
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path
}

const defaultSpawn: SpawnSsh = (command, args) =>
  nodeSpawn(command, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })

function freeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new SshError('No free local port.'))))
    })
  })
}

function acceptsConnections(endpoint: Endpoint): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect(endpoint.port, endpoint.host)
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1_000, () => done(false))
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
