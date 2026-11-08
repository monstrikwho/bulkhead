import type { ConnectionProfile } from '@bulkhead/core'
import {
  Emitter,
  readProfiles,
  type Localize,
  type ProfileList,
  type ProfileStore,
  type SecretStore,
} from '@bulkhead/host'

import type { JsonValue, OrcaSecrets, OrcaStorage } from './orcaApi'

/** The Orca side of the ports `@bulkhead/host` runs on. */

/** Orca has no l10n for plugins yet; English, with VS Code's `{0}` placeholders. */
export const t: Localize = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)]
    return value === undefined ? match : String(value)
  })

const PROFILES_KEY = 'connections'

/**
 * Profiles in the plugin's own storage, one JSON array like VS Code's `bulkhead.connections`, so
 * an exported VS Code setting can be pasted in. Kept in memory for the synchronous `list()`;
 * reloaded when anything else writes the key.
 */
export class OrcaProfileStore implements ProfileStore {
  private entries: unknown[] = []
  private readonly changed = new Emitter<void>()
  readonly onDidChange = this.changed.event

  private constructor(private readonly storage: OrcaStorage) {}

  static async open(storage: OrcaStorage): Promise<OrcaProfileStore> {
    const store = new OrcaProfileStore(storage)
    await store.reload()
    storage.onDidChange(({ key }) => {
      if (key !== PROFILES_KEY) return
      void store.reload().then((different) => {
        if (different) store.changed.fire()
      })
    })
    return store
  }

  list(): ProfileList {
    return readProfiles(this.entries)
  }

  get(id: string): ConnectionProfile | undefined {
    return this.list().profiles.find((profile) => profile.id === id)
  }

  async save(profile: ConnectionProfile): Promise<void> {
    const entries = [...this.entries]
    const index = entries.findIndex((entry) => idOf(entry) === profile.id)
    if (index === -1) entries.push(profile)
    else entries[index] = profile
    await this.write(entries)
  }

  async remove(id: string): Promise<void> {
    await this.write(this.entries.filter((entry) => idOf(entry) !== id))
  }

  dispose(): void {
    this.changed.dispose()
  }

  private async write(entries: unknown[]): Promise<void> {
    await this.storage.set(PROFILES_KEY, entries as JsonValue)
    this.entries = entries
    this.changed.fire()
  }

  /** Whether the stored entries differ from the ones in memory. */
  private async reload(): Promise<boolean> {
    const value = await this.storage.get(PROFILES_KEY)
    const entries = Array.isArray(value) ? value : []
    const different = JSON.stringify(entries) !== JSON.stringify(this.entries)
    this.entries = entries
    return different
  }
}

function idOf(entry: unknown): unknown {
  return (entry as { id?: unknown } | null)?.id
}

/** Orca keeps plugin secrets in a file encrypted with Electron safeStorage (OS keychain). */
export function orcaSecretStore(secrets: OrcaSecrets): SecretStore {
  return {
    get: async (key) => (await secrets.get(key)) ?? undefined,
    set: (key, value) => secrets.set(key, value),
    delete: (key) => secrets.delete(key),
  }
}
