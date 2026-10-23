import { ConfigError, parseConnectionProfile, type ConnectionProfile } from '@bulkhead/core'
import * as vscode from 'vscode'

const SECTION = 'bulkhead'
const KEY = 'connections'

export interface InvalidProfile {
  index: number
  name: string
  message: string
}

/**
 * Connection profiles live in the `bulkhead.connections` user setting: Settings Sync carries
 * them between machines and there is no account of our own. Secrets never go here.
 */
export class ConnectionStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changed.event
  private readonly subscription: vscode.Disposable

  constructor() {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.${KEY}`)) this.changed.fire()
    })
  }

  list(): { profiles: ConnectionProfile[]; invalid: InvalidProfile[] } {
    const raw = vscode.workspace.getConfiguration(SECTION).get<unknown[]>(KEY, [])
    const profiles: ConnectionProfile[] = []
    const invalid: InvalidProfile[] = []
    raw.forEach((entry, index) => {
      try {
        profiles.push(parseConnectionProfile(entry))
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error
        const name = (entry as { name?: unknown } | null)?.name
        invalid.push({
          index,
          name: typeof name === 'string' ? name : `#${index + 1}`,
          message: error.message,
        })
      }
    })
    return { profiles, invalid }
  }

  get(id: string): ConnectionProfile | undefined {
    return this.list().profiles.find((profile) => profile.id === id)
  }

  async save(profile: ConnectionProfile): Promise<void> {
    const raw = this.raw()
    const index = raw.findIndex((entry) => (entry as { id?: unknown } | null)?.id === profile.id)
    if (index === -1) raw.push(profile)
    else raw[index] = profile
    await this.write(raw)
  }

  async remove(id: string): Promise<void> {
    await this.write(this.raw().filter((entry) => (entry as { id?: unknown } | null)?.id !== id))
  }

  dispose(): void {
    this.subscription.dispose()
    this.changed.dispose()
  }

  /** Raw entries, so saving one profile never rewrites or drops entries we failed to parse. */
  private raw(): unknown[] {
    const inspected = vscode.workspace.getConfiguration(SECTION).inspect<unknown[]>(KEY)
    return [...(inspected?.globalValue ?? [])]
  }

  private async write(entries: unknown[]): Promise<void> {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update(KEY, entries, vscode.ConfigurationTarget.Global)
  }
}
