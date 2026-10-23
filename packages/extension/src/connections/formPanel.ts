import { randomUUID } from 'node:crypto'

import {
  ConfigError,
  connectionDraftSchema,
  formatIssues,
  isFormWebviewToHost,
  parseConnectionProfile,
  type ConnectionDraft,
  type ConnectionProfile,
  type DriverDescriptor,
  type FormHostToWebview,
  type ParseResult,
} from '@bulkhead/core'
import * as vscode from 'vscode'

import { driverFor, drivers } from '../drivers'
import { webviewHtml, webviewRoot } from '../webview/html'
import type { ConnectionManager } from './manager'
import type { SecretVault } from './secrets'
import type { ConnectionStore } from './store'

export interface FormDependencies {
  extensionUri: vscode.Uri
  store: ConnectionStore
  secrets: SecretVault
  manager: ConnectionManager
}

/**
 * The "new connection" / "edit connection" page: a webview in the editor area. One panel per
 * connection being edited, and one for a new connection; opening it again reveals it.
 */
export class ConnectionFormPanel {
  private static readonly open = new Map<string, ConnectionFormPanel>()

  static show(deps: FormDependencies, existing?: ConnectionProfile): void {
    const key = existing?.id ?? 'new'
    const current = ConnectionFormPanel.open.get(key)
    if (current) {
      current.panel.reveal()
      return
    }
    ConnectionFormPanel.open.set(key, new ConnectionFormPanel(deps, key, existing))
  }

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []

  private constructor(
    private readonly deps: FormDependencies,
    private readonly key: string,
    private readonly existing: ConnectionProfile | undefined,
  ) {
    const title = existing
      ? vscode.l10n.t('Edit {0}', existing.name)
      : vscode.l10n.t('New Connection')
    this.panel = vscode.window.createWebviewPanel(
      'bulkhead.connectionForm',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot(deps.extensionUri)],
      },
    )
    this.panel.iconPath = vscode.Uri.joinPath(deps.extensionUri, 'media', 'bulkhead.svg')
    this.panel.webview.html = webviewHtml(
      this.panel.webview,
      deps.extensionUri,
      'connection-form',
      title,
    )
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => void this.receive(message)),
      this.panel.onDidDispose(() => this.dispose()),
    )
  }

  private post(message: FormHostToWebview): void {
    void this.panel.webview.postMessage(message)
  }

  private async receive(message: unknown): Promise<void> {
    if (!isFormWebviewToHost(message)) return
    switch (message.type) {
      case 'ready':
        this.post({
          type: 'init',
          drivers: [...drivers.values()].map((driver): DriverDescriptor => ({
            kind: driver.kind,
            displayName: driver.displayName,
            optionFields: driver.optionFields,
            secretFields: driver.secretFields,
          })),
          existing: this.existing && (await this.existingDraft(this.existing)),
        })
        break
      case 'parse':
        this.post({ type: 'parsed', requestId: message.requestId, result: parse(message.text) })
        break
      case 'test':
        this.post({
          type: 'test-result',
          requestId: message.requestId,
          result: await this.test(message.draft),
        })
        break
      case 'save':
        await this.save(message.draft)
        break
      case 'cancel':
        this.panel.dispose()
        break
    }
  }

  private async existingDraft(
    profile: ConnectionProfile,
  ): Promise<{ draft: ConnectionDraft; savedSecrets: string[] }> {
    const savedSecrets: string[] = []
    for (const field of driverFor(profile.driver).secretFields) {
      if ((await this.deps.secrets.get(profile.id, field.key)) !== undefined) {
        savedSecrets.push(field.key)
      }
    }
    return {
      draft: {
        id: profile.id,
        name: profile.name,
        driver: profile.driver,
        production: profile.production,
        readOnly: profile.readOnly ?? false,
        options: profile.options,
        secrets: {},
      },
      savedSecrets,
    }
  }

  private async test(
    raw: unknown,
  ): Promise<
    { ok: true; durationMs: number; databases: string[] } | { ok: false; message: string }
  > {
    try {
      const draft = parseDraft(raw)
      const profile = toProfile(draft, { requireName: false })
      const secrets = await this.secretsFor(draft, profile)
      return { ok: true, ...(await this.deps.manager.probe(profile, secrets)) }
    } catch (error) {
      return { ok: false, message: describeError(error) }
    }
  }

  private async save(raw: unknown): Promise<void> {
    let profile: ConnectionProfile
    let draft: ConnectionDraft
    try {
      draft = parseDraft(raw)
      profile = toProfile(draft, { requireName: true })
    } catch (error) {
      this.post({ type: 'save-failed', message: describeError(error) })
      return
    }

    for (const field of driverFor(profile.driver).secretFields) {
      const typed = draft.secrets[field.key] ?? ''
      // Editing: empty keeps the saved value. New: empty is stored, meaning "no password".
      if (typed !== '' || !this.existing) await this.deps.secrets.set(profile.id, field.key, typed)
    }
    if (this.existing) await this.deps.manager.disconnect(profile.id)
    await this.deps.store.save(profile)
    this.panel.dispose()
    await vscode.commands.executeCommand('bulkhead.connections.focus')
  }

  /** Typed secrets win; when editing, empty fields fall back to the saved ones. */
  private async secretsFor(
    draft: ConnectionDraft,
    profile: ConnectionProfile,
  ): Promise<Record<string, string>> {
    const secrets: Record<string, string> = {}
    for (const field of driverFor(profile.driver).secretFields) {
      const value =
        draft.secrets[field.key] ||
        (this.existing ? await this.deps.secrets.get(profile.id, field.key) : undefined)
      if (value) secrets[field.key] = value
    }
    return secrets
  }

  private dispose(): void {
    ConnectionFormPanel.open.delete(this.key)
    for (const disposable of this.disposables) disposable.dispose()
  }
}

function parseDraft(raw: unknown): ConnectionDraft {
  const result = connectionDraftSchema.safeParse(raw)
  if (!result.success) throw new ConfigError(formatIssues(result.error))
  return result.data
}

/** Builds and validates the profile the draft describes; throws `ConfigError`. */
function toProfile(
  draft: ConnectionDraft,
  { requireName }: { requireName: boolean },
): ConnectionProfile {
  const name = draft.name.trim()
  if (requireName && !name) throw new ConfigError(vscode.l10n.t('Give the connection a name.'))
  const driver = driverFor(draft.driver)
  // Empty fields mean "use the driver's default".
  const options = Object.fromEntries(
    Object.entries(draft.options)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value] as const)
      .filter(([, value]) => value !== '' && value !== undefined && value !== null),
  )
  driver.parseOptions(options)
  return parseConnectionProfile({
    id: draft.id ?? randomUUID(),
    name: name || driver.displayName,
    driver: draft.driver,
    production: draft.production,
    // Production is always read-only at first; the flag only matters for other connections.
    ...(draft.readOnly && !draft.production ? { readOnly: true } : {}),
    options,
  })
}

/** Tries every driver; `null` when the text is not a connection string at all. */
function parse(text: string): ParseResult | null {
  for (const driver of drivers.values()) {
    try {
      const parsed = driver.parseConnectionString?.(text)
      if (parsed) return { ok: true, driver: driver.kind, ...parsed }
    } catch (error) {
      return { ok: false, message: describeError(error) }
    }
  }
  return null
}

/**
 * A readable one-liner. Node reports a refused `localhost` as an `AggregateError` with an empty
 * message (one attempt per address, IPv6 and IPv4), so its inner errors are spelled out.
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) {
    const inner = [...new Set(error.errors.map((item: unknown) => describeError(item)))]
    return inner.join('; ')
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    if (error.message) return error.message
    if (typeof code === 'string') return code
    return error.name
  }
  return String(error)
}
