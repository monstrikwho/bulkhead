import type { SecretField } from '@bulkhead/core'

import type { SecretStore } from '../ports'

/**
 * Passwords and keys in the host's secret store (VS Code: SecretStorage, the OS keychain). It is
 * per machine and is not synced, so a profile synced to a new machine asks for its password once.
 * The key format is what existing installs have stored under: keep it.
 */
export class SecretVault {
  constructor(private readonly storage: SecretStore) {}

  async get(profileId: string, key: string): Promise<string | undefined> {
    return this.storage.get(this.key(profileId, key))
  }

  async set(profileId: string, key: string, value: string): Promise<void> {
    await this.storage.set(this.key(profileId, key), value)
  }

  async deleteAll(profileId: string, fields: readonly SecretField[]): Promise<void> {
    await Promise.all(fields.map((field) => this.storage.delete(this.key(profileId, field.key))))
  }

  private key(profileId: string, key: string): string {
    return `bulkhead.connection.${profileId}.${key}`
  }
}
