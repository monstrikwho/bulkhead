import type { ConnectionProfile } from '@bulkhead/core'
import type { HostUi, Localize, SecretStore } from '@bulkhead/host'
import * as vscode from 'vscode'

/** The VS Code side of the ports `@bulkhead/host` runs on. */

export const t: Localize = (message, ...args) => vscode.l10n.t(message, ...args)

/** SecretStorage keeps secrets in the OS keychain, per machine, never synced. */
export function secretStore(storage: vscode.SecretStorage): SecretStore {
  return {
    get: async (key) => storage.get(key),
    set: async (key, value) => storage.store(key, value),
    delete: async (key) => storage.delete(key),
  }
}

export function vscodeUi(openConnectionForm: HostUi['openConnectionForm']): HostUi {
  return {
    askSecret: async (profile, field) =>
      vscode.window.showInputBox({
        title: `${profile.name}: ${field.label}`,
        prompt: vscode.l10n.t('Stored in VS Code SecretStorage on this machine.'),
        password: true,
        ignoreFocusOut: true,
      }),
    confirmUnlock,
    openConnectionForm,
    showInfo: (message) => void vscode.window.showInformationMessage(message),
    showWarning: (message) => void vscode.window.showWarningMessage(message),
    showError: (message) => void vscode.window.showErrorMessage(message),
  }
}

/**
 * Unlocking a production connection requires typing its name: a deliberate act, not a reflex
 * click. Other read-only connections only need a confirmation.
 */
async function confirmUnlock(profile: ConnectionProfile): Promise<boolean> {
  if (!profile.production) {
    const unlock = vscode.l10n.t('Unlock')
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('Allow writes on "{0}" until you disconnect?', profile.name),
      { modal: true },
      unlock,
    )
    return answer === unlock
  }
  const typed = await vscode.window.showInputBox({
    title: vscode.l10n.t('Unlock writes on PRODUCTION'),
    prompt: vscode.l10n.t(
      'Writes stay unlocked until you disconnect or lock them again. Type "{0}" to confirm.',
      profile.name,
    ),
    ignoreFocusOut: true,
    validateInput: (value) =>
      value === profile.name ? undefined : vscode.l10n.t('Type the connection name exactly'),
  })
  return typed === profile.name
}
