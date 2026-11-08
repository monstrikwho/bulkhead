import type { ConnectionProfile } from '@bulkhead/core'

import { readProfiles } from './connections/profiles'
import { Emitter } from './events'
import type { HostUi, ProfileList, ProfileStore, SecretStore } from './ports'

/** In-memory ports for unit tests; no host involved. */

export class MemoryProfiles implements ProfileStore {
  readonly entries: unknown[] = []
  private readonly changed = new Emitter<void>()
  readonly onDidChange = this.changed.event

  list(): ProfileList {
    return readProfiles(this.entries)
  }

  get(id: string): ConnectionProfile | undefined {
    return this.list().profiles.find((profile) => profile.id === id)
  }

  save(profile: ConnectionProfile): Promise<void> {
    const index = this.entries.findIndex((entry) => (entry as { id?: unknown }).id === profile.id)
    if (index === -1) this.entries.push(profile)
    else this.entries[index] = profile
    this.changed.fire()
    return Promise.resolve()
  }

  remove(id: string): Promise<void> {
    const index = this.entries.findIndex((entry) => (entry as { id?: unknown }).id === id)
    if (index !== -1) this.entries.splice(index, 1)
    this.changed.fire()
    return Promise.resolve()
  }
}

export class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>()

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key))
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }
}

/** Records what the runtime shows; prompts answer with `answers`. */
export class RecordingUi implements HostUi {
  readonly shown: Array<{ level: 'info' | 'warning' | 'error'; message: string }> = []
  readonly forms: Array<Parameters<HostUi['openConnectionForm']>> = []
  secret: string | undefined = undefined
  unlock = false

  askSecret(): Promise<string | undefined> {
    return Promise.resolve(this.secret)
  }

  confirmUnlock(): Promise<boolean> {
    return Promise.resolve(this.unlock)
  }

  openConnectionForm(...args: Parameters<HostUi['openConnectionForm']>): void {
    this.forms.push(args)
  }

  showInfo(message: string): void {
    this.shown.push({ level: 'info', message })
  }

  showWarning(message: string): void {
    this.shown.push({ level: 'warning', message })
  }

  showError(message: string): void {
    this.shown.push({ level: 'error', message })
  }
}

/** Like `vscode.l10n.t` without a bundle: fills in `{0}`, `{1}` … */
export function format(message: string, ...args: Array<string | number | boolean>): string {
  return message.replace(/\{(\d+)\}/g, (match, index: string) =>
    index in args ? String(args[Number(index)]) : match,
  )
}
