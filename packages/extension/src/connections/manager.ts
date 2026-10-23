import {
  createTransport,
  initialAccessMode,
  type AccessMode,
  type ConnectionProfile,
  type DriverSession,
  type Tunnel,
} from '@bulkhead/core'
import * as vscode from 'vscode'

import { driverFor } from '../drivers'
import type { SecretVault } from './secrets'

interface Live {
  session: DriverSession
  tunnel: Tunnel
  /** Profile as it was when connected; a changed profile means a reconnect. */
  fingerprint: string
}

/**
 * Owns live sessions. The access mode of a connection comes from its profile; an explicit
 * unlock or lock is an in-memory override that lasts until the user disconnects or the window
 * reloads, so a production connection always comes back read-only.
 */
export class ConnectionManager implements vscode.Disposable {
  private readonly live = new Map<string, Live>()
  private readonly pending = new Map<string, Promise<Live>>()
  private readonly overrides = new Map<string, AccessMode>()
  private readonly changed = new vscode.EventEmitter<string>()
  /** Fires with a connection id whenever it connects, disconnects or changes access mode. */
  readonly onDidChange = this.changed.event

  constructor(private readonly secrets: SecretVault) {}

  isConnected(id: string): boolean {
    return this.live.has(id)
  }

  accessMode(profile: ConnectionProfile): AccessMode {
    return this.overrides.get(profile.id) ?? initialAccessMode(profile)
  }

  async session(profile: ConnectionProfile): Promise<DriverSession> {
    const current = this.live.get(profile.id)
    if (current && current.fingerprint === fingerprint(profile, this.accessMode(profile))) {
      return current.session
    }
    if (current) await this.close(profile.id)

    let pending = this.pending.get(profile.id)
    if (!pending) {
      pending = this.open(profile).finally(() => this.pending.delete(profile.id))
      this.pending.set(profile.id, pending)
    }
    return (await pending).session
  }

  /** Reconnects with a new access mode. Keeps the override across the reconnect. */
  async setAccessMode(profile: ConnectionProfile, mode: AccessMode): Promise<void> {
    if (mode === initialAccessMode(profile)) this.overrides.delete(profile.id)
    else this.overrides.set(profile.id, mode)
    if (this.live.has(profile.id)) {
      await this.close(profile.id)
      await this.session(profile)
    }
    this.changed.fire(profile.id)
  }

  /** User-initiated disconnect: also drops any unlock, so the next connect starts safe. */
  async disconnect(id: string): Promise<void> {
    this.overrides.delete(id)
    await this.close(id)
    this.changed.fire(id)
  }

  /** Closes sessions whose profile was removed or edited. */
  async reconcile(profiles: readonly ConnectionProfile[]): Promise<void> {
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))
    for (const [id, live] of this.live) {
      const profile = byId.get(id)
      if (!profile || live.fingerprint !== fingerprint(profile, this.accessMode(profile))) {
        await this.disconnect(id)
      }
    }
  }

  dispose(): void {
    for (const id of [...this.live.keys()]) this.close(id).catch(() => undefined)
    this.changed.dispose()
  }

  private async open(profile: ConnectionProfile): Promise<Live> {
    const driver = driverFor(profile.driver)
    const options = driver.parseOptions(profile.options)
    const secrets = await this.resolveSecrets(profile)
    const accessMode = this.accessMode(profile)
    const tunnel = await createTransport(profile.transport).open(driver.target(options))
    try {
      const session = await driver.connect({
        profile,
        options,
        endpoint: tunnel.endpoint,
        secrets,
        accessMode,
      })
      const live = { session, tunnel, fingerprint: fingerprint(profile, accessMode) }
      this.live.set(profile.id, live)
      this.changed.fire(profile.id)
      return live
    } catch (error) {
      await tunnel.close()
      throw error
    }
  }

  private async close(id: string): Promise<void> {
    const live = this.live.get(id)
    if (!live) return
    this.live.delete(id)
    await live.session.close()
    await live.tunnel.close()
  }

  private async resolveSecrets(profile: ConnectionProfile): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {}
    for (const field of driverFor(profile.driver).secretFields) {
      let value = await this.secrets.get(profile.id, field.key)
      if (value === undefined) {
        value = await vscode.window.showInputBox({
          title: `${profile.name}: ${field.label}`,
          prompt: vscode.l10n.t('Stored in VS Code SecretStorage on this machine.'),
          password: true,
          ignoreFocusOut: true,
        })
        if (value === undefined && !field.optional) {
          throw new vscode.CancellationError()
        }
        if (value !== undefined) await this.secrets.set(profile.id, field.key, value)
      }
      // An empty stored value means "no password" (trust or peer auth): don't ask again.
      if (value) resolved[field.key] = value
    }
    return resolved
  }
}

function fingerprint(profile: ConnectionProfile, mode: AccessMode): string {
  return JSON.stringify([profile.driver, profile.transport, profile.options, mode])
}
