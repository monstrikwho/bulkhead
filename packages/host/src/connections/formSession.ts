import {
  isFormWebviewToHost,
  type ConnectionProfile,
  type FormHostToWebview,
  type FormStartData,
  type ProposedDraft,
} from '@bulkhead/core'

import { driverFor, drivers } from '../drivers'
import {
  describeDriver,
  describeError,
  parseConnectionString,
  parseDraft,
  saveDraft,
  savedDraft,
  testDraft,
  type DraftDependencies,
} from './drafts'

/**
 * One open connection form, whatever draws it (a VS Code webview panel, an Orca panel): answers
 * the form's messages with the same draft checks the MCP tools use. The host only carries the
 * messages and closes its page when `close` is called.
 */
export class FormSession {
  private ready = false

  constructor(
    private readonly deps: DraftDependencies,
    readonly existing: ConnectionProfile | undefined,
    private proposal: ProposedDraft | undefined,
    private readonly post: (message: FormHostToWebview) => void,
    /** The form is done: `saved` after a save, `undefined` after cancel. */
    private readonly close: (saved: ConnectionProfile | undefined) => void,
  ) {}

  async receive(message: unknown): Promise<void> {
    if (!isFormWebviewToHost(message)) return
    switch (message.type) {
      case 'ready':
        this.ready = true
        await this.init()
        break
      case 'parse':
        this.post({
          type: 'parsed',
          requestId: message.requestId,
          result: parseConnectionString(message.text),
        })
        break
      case 'test':
        this.post({
          type: 'test-result',
          requestId: message.requestId,
          result: await testDraft(this.deps, message.draft, this.existing),
        })
        break
      case 'save':
        await this.save(message.draft)
        break
      case 'cancel':
        this.close(undefined)
        break
    }
  }

  private async init(): Promise<void> {
    let start: FormStartData | undefined
    if (this.existing) start = await savedDraft(this.existing, this.deps.secrets)
    if (this.proposal) {
      const { draft, changed, warnings } = this.proposal
      start = { draft, savedSecrets: start?.savedSecrets ?? [], proposal: { changed, warnings } }
    }
    this.post({
      type: 'init',
      drivers: [...drivers.values()].map(describeDriver),
      ...(start ? { start } : {}),
    })
  }

  private async save(raw: unknown): Promise<void> {
    let saved: ConnectionProfile
    try {
      saved = await saveDraft(this.deps, parseDraft(raw), this.existing)
    } catch (error) {
      this.post({ type: 'save-failed', message: describeError(error) })
      return
    }
    this.close(saved)
  }
}

/** Removes a connection with its saved secrets, after the host has asked the user. */
export async function removeConnection(
  deps: DraftDependencies,
  profile: ConnectionProfile,
): Promise<void> {
  await deps.manager.disconnect(profile.id)
  await deps.secrets.deleteAll(profile.id, driverFor(profile.driver).secretFields)
  await deps.store.remove(profile.id)
}

/**
 * An AI agent proposed a connection while a form is already open. The form may hold what the
 * user typed (a password, a fix to the agent's last proposal); replacing it silently loses that,
 * so the proposal is refused and the agent is told why.
 */
export class FormBusyError extends Error {
  constructor(name?: string) {
    super(
      `${name ? `The form of "${name}"` : 'A connection form'} is already open and may hold ` +
        'unsaved changes. Ask the user to save or cancel it, then call configure_connection again.',
    )
    this.name = 'FormBusyError'
  }
}
