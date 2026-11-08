import type { ConnectionProfile } from '@bulkhead/core'
import { readProfiles, type ProfileList, type ProfileStore } from '@bulkhead/host'
import * as vscode from 'vscode'

const SECTION = 'bulkhead'
const KEY = 'connections'

/**
 * Connection profiles live in the `bulkhead.connections` user setting: Settings Sync carries
 * them between machines and there is no account of our own. Secrets never go here.
 */
export class ConnectionStore implements ProfileStore, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changed.event
  private readonly subscription: vscode.Disposable

  constructor() {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.${KEY}`)) this.changed.fire()
    })
  }

  list(): ProfileList {
    return readProfiles(vscode.workspace.getConfiguration(SECTION).get<unknown[]>(KEY, []))
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
