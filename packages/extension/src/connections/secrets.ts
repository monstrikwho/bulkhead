import type { SecretField } from '@bulkhead/core'
import type * as vscode from 'vscode'

/**
 * Passwords and keys in VS Code SecretStorage (the OS keychain). SecretStorage is per machine
 * and is not synced, so a profile synced to a new machine asks for its password once.
 */
export class SecretVault {
  constructor(private readonly storage: vscode.SecretStorage) {}

  async get(profileId: string, key: string): Promise<string | undefined> {
    return this.storage.get(this.key(profileId, key))
  }

  async set(profileId: string, key: string, value: string): Promise<void> {
    await this.storage.store(this.key(profileId, key), value)
  }

  async deleteAll(profileId: string, fields: readonly SecretField[]): Promise<void> {
    await Promise.all(fields.map((field) => this.storage.delete(this.key(profileId, field.key))))
  }

  private key(profileId: string, key: string): string {
    return `bulkhead.connection.${profileId}.${key}`
  }
}
