import type { ConnectionProfile, HostToWebview, ProposedDraft, SecretField } from '@bulkhead/core'

import type { Event } from './events'

/**
 * What an editor host (VS Code, Orca, …) provides to the shared runtime. Each port holds only
 * what the runtime calls; anything a host does on its own (trees, editors, commands) stays in
 * the host adapter.
 */

/**
 * Localizes a user-facing string: `{0}`, `{1}` … are replaced by the arguments. VS Code passes
 * `vscode.l10n.t`, so the message strings double as l10n keys and must not be reworded lightly.
 */
export type Localize = (message: string, ...args: Array<string | number | boolean>) => string

export interface InvalidProfile {
  index: number
  name: string
  message: string
}

export interface ProfileList {
  profiles: ConnectionProfile[]
  /** Entries that failed validation; kept in storage untouched and reported, never dropped. */
  invalid: InvalidProfile[]
}

/** Where connection profiles live (VS Code: the `bulkhead.connections` user setting). */
export interface ProfileStore {
  list(): ProfileList
  get(id: string): ConnectionProfile | undefined
  /** Adds the profile, or replaces the one with the same id. */
  save(profile: ConnectionProfile): Promise<void>
  remove(id: string): Promise<void>
  readonly onDidChange: Event<void>
}

/**
 * A key-value store for secrets backed by the OS keychain (VS Code: SecretStorage). The runtime
 * reaches it only through `SecretVault`, which owns the key format.
 */
export interface SecretStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Where a query run reports to: a results panel or a table tab. */
export interface ResultsTarget {
  reveal(): Promise<void> | void
  post(message: HostToWebview): void
}

/** The few places where the runtime needs the user. */
export interface HostUi {
  /** Asks for a secret that is not stored yet; `undefined` when the user dismisses the prompt. */
  askSecret(profile: ConnectionProfile, field: SecretField): Promise<string | undefined>
  /**
   * Confirms unlocking writes. Production must take a deliberate act (VS Code: typing the
   * connection name), not a reflex click.
   */
  confirmUnlock(profile: ConnectionProfile): Promise<boolean>
  /**
   * Opens the connection form: a saved connection, or a new one. `proposal` is a draft an AI
   * agent filled in; the form says so, and saving stays the user's click.
   */
  openConnectionForm(existing?: ConnectionProfile, proposal?: ProposedDraft): void
  showInfo(message: string): void
  showWarning(message: string): void
  showError(message: string): void
}

/** The user dismissed a prompt the operation needed; callers stay silent about it. */
export class CancellationError extends Error {
  constructor() {
    // Same message and name as `vscode.CancellationError`.
    super('Canceled')
    this.name = 'Canceled'
  }
}
