import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  isWebviewToHost,
  PANEL,
  type ChildrenRequest,
  type ConnectionAction,
  type ConnectionProfile,
  type ConnectionRequest,
  type ExplorerNode,
  type OpenConsoleRequest,
  type OpenTableRequest,
  type PanelReply,
  type PanelState,
  type PromptAnswer,
  type ProposedDraft,
  type RunRequest,
  type WelcomeAction,
} from '@bulkhead/core'
import {
  AgentAccess,
  CancellationError,
  ConnectionManager,
  describeConnection,
  describeError,
  FormBusyError,
  FormSession,
  pickStatement,
  QueryRunner,
  removeConnection,
  SecretVault,
  unlockWrites,
  type DraftDependencies,
  type HostUi,
} from '@bulkhead/host'

import { toJson } from './json'
import type { JsonValue, OrcaWorker, PanelRequestContext } from './orcaApi'
import { PanelHost } from './panelHost'
import { OrcaProfileStore, orcaSecretStore, t } from './ports'
import {
  consoleFile,
  orcaCliAddFolder,
  tableFile,
  TABS_FOLDER,
  tabsWorkspace,
  type AddFolder,
  type Workspace,
} from './tabFiles'

export interface PluginOptions {
  /** Where the bridge copy and the instance files live; agents keep this path in config. */
  storageDir: string
  /** The built stdio bridge shipped with the plugin. */
  bridgeSource: string
  version: string
  maxRows?: number
  /** Adds the folder of consoles and table tabs to Orca; Orca's CLI unless a test swaps it. */
  addFolder?: AddFolder
}

/**
 * Bulkhead inside Orca: the host ports on Orca's storage, secrets and panel, the same
 * `@bulkhead/host` runtime as VS Code (sessions, read-only mode, drafts, MCP), and the request
 * handlers of the Bulkhead panel. Nothing here decides about safety on its own: unlocking goes
 * through `unlockWrites`, saving through `FormSession`/`saveDraft`, exactly as in VS Code.
 */
export class BulkheadOrca {
  readonly panel: PanelHost
  readonly ui: HostUi
  private store: OrcaProfileStore | undefined
  private manager: ConnectionManager | undefined
  private queries: QueryRunner | undefined
  private agents: AgentAccess | undefined
  private form: FormSession | undefined
  private deps: DraftDependencies | undefined
  private readonly ready: Promise<void>
  private readonly disposables: { dispose(): void }[] = []

  constructor(
    private readonly orca: OrcaWorker,
    private readonly options: PluginOptions,
  ) {
    this.panel = new PanelHost(orca)
    this.ui = this.createUi()
    // Handlers first, before anything is awaited: the panel request that started the worker
    // must find its handler. They wait for `ready` themselves.
    this.registerHandlers()
    this.ready = this.start()
  }

  /** Resolves when profiles are loaded and the MCP server has started (or failed to). */
  whenReady(): Promise<void> {
    return this.ready
  }

  async dispose(): Promise<void> {
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    this.panel.dispose()
    await this.agents?.setEnabled(false)
    this.agents?.dispose()
    this.manager?.dispose()
    this.store?.dispose()
  }

  private async start(): Promise<void> {
    const store = await OrcaProfileStore.open(this.orca.storage)
    const secrets = new SecretVault(orcaSecretStore(this.orca.secrets))
    const manager = new ConnectionManager(secrets, this.ui)
    this.store = store
    this.manager = manager
    this.deps = { store, secrets, manager, t }
    this.queries = new QueryRunner(manager, {
      // Every Orca run names its tab's target; nothing runs into a default one.
      results: { reveal: () => undefined, post: () => undefined },
      maxRows: () => this.options.maxRows ?? 1000,
      ui: this.ui,
      t,
    })
    this.disposables.push(
      store.onDidChange(() => {
        void manager.reconcile(store.list().profiles)
        this.panel.changed()
      }),
      manager.onDidChange(() => {
        this.panel.changed()
        void this.updateStatus()
      }),
    )
    this.agents = new AgentAccess({
      deps: this.deps,
      ui: this.ui,
      storageDir: this.options.storageDir,
      bridgeSource: this.options.bridgeSource,
      version: this.options.version,
      hostName: 'Orca',
      // One Orca process serves every workspace; the bridge takes the newest instance.
      workspaceFolders: () => [],
    })
    this.disposables.push(this.agents.onDidChange(() => void this.updateStatus()))
    await this.agents.setEnabled(true)
    await this.updateStatus()
  }

  private createUi(): HostUi {
    const notify = (message: string) =>
      void this.orca.host
        .call('notifications.show', { title: 'Bulkhead', body: message })
        .catch((error: unknown) => this.orca.log(`notification failed: ${describeError(error)}`))
    return {
      askSecret: async (profile, field) =>
        (await this.panel.ask({
          kind: 'secret',
          title: `${profile.name}: ${field.label}`,
          label: field.label,
        })) ?? undefined,
      // The panel shows the question; the worker compares the answer, so a panel bug cannot
      // unlock production without the typed name.
      confirmUnlock: async (profile) => {
        const answer = await this.panel.ask({
          kind: 'unlock',
          name: profile.name,
          production: profile.production,
        })
        return profile.production ? answer === profile.name : answer !== null
      },
      openConnectionForm: (existing, proposal) => this.openForm(existing, proposal),
      showInfo: (message) => {
        this.orca.log(message)
        notify(message)
      },
      showWarning: (message) => {
        this.orca.log(`warning: ${message}`)
        notify(message)
      },
      // Errors are about something the user just did in the panel, which shows them already
      // (results, a failed request); a desktop notification would only repeat them.
      showError: (message) => this.orca.log(`error: ${message}`),
    }
  }

  private openForm(existing?: ConnectionProfile, proposal?: ProposedDraft): void {
    const deps = this.deps
    if (!deps) return
    const current = this.form
    // An agent never replaces an open form: it may hold what the user typed.
    if (current && proposal) throw new FormBusyError(current.existing?.name)
    const mounted = this.panel.view === 'form'
    const form = new FormSession(
      deps,
      existing,
      proposal,
      (message) => this.panel.pushWebview(message),
      () => {
        if (this.form !== form) return
        this.form = undefined
        this.panel.setView('main')
        this.panel.changed()
      },
    )
    this.form = form
    // A form app already on screen asked for `init` long ago; give the new form its start.
    if (mounted) void form.receive({ type: 'ready' })
    this.panel.setView('form')
    if (proposal) {
      this.ui.showInfo(
        'An AI agent filled in a connection. Review and save it in the Bulkhead panel.',
      )
    }
  }

  private registerHandlers(): void {
    const handle = <Input, Output>(
      name: string,
      run: (input: Input, context: PanelRequestContext) => Output | Promise<Output>,
    ) => {
      this.disposables.push(
        this.orca.panels.handle(name, async (input, context): Promise<JsonValue> => {
          try {
            await this.ready
            const value = await run((input ?? {}) as Input, context)
            return toJson({ ok: true, value: value ?? null } satisfies PanelReply<unknown>)
          } catch (error) {
            const message = error instanceof CancellationError ? 'Cancelled.' : describeError(error)
            // The panel shows it too, but only the log survives for `orca plugin logs`.
            this.orca.log(`${name} failed: ${message}`)
            return { ok: false, message } satisfies PanelReply<JsonValue>
          }
        }),
      )
    }

    // Results messages come from editor tabs, form messages from the sidebar; both say `ready`.
    this.disposables.push(
      this.orca.panels.handle(PANEL.webview, async (message, context) => {
        await this.ready
        const frame = context.panel
        if (isWebviewToHost(message)) {
          switch (message.type) {
            case 'ready':
              // Names the frame for `orca plugin dev request --panel` when checking a tab.
              if (frame.surface === 'editor')
                this.orca.log(`${frame.contributionId} tab ${frame.id}`)
              this.panel.replay(frame.id)
              break
            case 'cancel':
              this.queries?.cancel(message.runId)
              return null
            case 'refresh': {
              const last = this.panel.results(frame.id).lastRequest
              if (last) this.run(last, context)
              return null
            }
            case 'action':
              this.welcomeAction(message.action, frame.surface === 'editor')
              return null
            default:
              return null
          }
        }
        if (frame.surface === 'panel') await this.form?.receive(message)
        return null
      }),
    )
    this.disposables.push(
      this.orca.panels.handle(PANEL.page, (input) => {
        const { id, index } = (input ?? {}) as { id?: unknown; index?: unknown }
        if (typeof id !== 'string' || typeof index !== 'number') throw new Error('Bad page request')
        return this.panel.page(id, index)
      }),
    )

    handle(PANEL.state, () => this.state())
    handle(PANEL.children, async ({ connectionId, node }: ChildrenRequest) => {
      const profile = this.profile(connectionId)
      const session = await this.manager!.session(profile)
      return session.listChildren(node && checkNode(node))
    })
    handle(PANEL.connection, ({ connectionId, action }: ConnectionRequest) =>
      this.connectionAction(this.profile(connectionId), action),
    )
    handle(PANEL.newConnection, () => this.openForm())
    handle(PANEL.run, (request: RunRequest, context) => this.run(request, context))
    handle(PANEL.openConsole, async ({ connectionId }: OpenConsoleRequest) => {
      const profile = this.profile(connectionId)
      const workspace = await this.tabsWorkspace()
      await this.openTab(workspace, await consoleFile(workspace, profile))
    })
    handle(PANEL.openTable, async ({ connectionId, node }: OpenTableRequest) => {
      const profile = this.profile(connectionId)
      const workspace = await this.tabsWorkspace()
      await this.openTab(workspace, await tableFile(workspace, profile, checkNode(node)))
    })
    handle(PANEL.prompt, (answer: PromptAnswer) => {
      if (typeof answer.id !== 'string') throw new Error('Bad answer')
      this.panel.answer({
        id: answer.id,
        value: typeof answer.value === 'string' ? answer.value : null,
      })
    })
    handle(PANEL.agentSetup, () => this.agentSetup())
    this.disposables.push(
      this.orca.commands.register('bulkhead.connectAgent', async () => {
        await this.ready
        return toJson(this.agentSetup())
      }),
    )
  }

  private state(): PanelState {
    const { profiles, invalid } = this.store!.list()
    const manager = this.manager!
    const server = this.agents?.running
    return {
      connections: profiles.map((profile) => {
        let target: string
        try {
          target = describeConnection(profile)
        } catch (error) {
          target = `invalid: ${describeError(error)}`
        }
        return {
          id: profile.id,
          name: profile.name,
          driver: profile.driver,
          production: profile.production,
          accessMode: manager.accessMode(profile),
          connected: manager.isConnected(profile.id),
          target,
        }
      }),
      invalid: invalid.map(({ name, message }) => ({ name, message })),
      view: this.panel.view,
      agents: server
        ? { running: true, detail: `MCP on 127.0.0.1:${server.port}` }
        : { running: false, detail: 'MCP server is not running; see orca plugin logs.' },
    }
  }

  private async connectionAction(
    profile: ConnectionProfile,
    action: ConnectionAction,
  ): Promise<void> {
    const manager = this.manager!
    switch (action) {
      case 'connect':
        await manager.session(profile)
        return
      case 'disconnect':
        await manager.disconnect(profile.id)
        return
      case 'unlock':
        await unlockWrites(manager, this.ui, profile)
        return
      case 'lock':
        await manager.setAccessMode(profile, 'read-only')
        return
      case 'edit':
        this.openForm(profile)
        return
      case 'remove':
        // The panel asked "Remove …?" before sending this.
        await removeConnection(this.deps!, profile)
        return
      default:
        throw new Error(`Unknown action ${String(action)}`)
    }
  }

  private run(request: RunRequest, context: PanelRequestContext): void {
    const { connectionId, text, mode, offset, database, notice } = request
    const profile = this.profile(connectionId)
    if (typeof text !== 'string') throw new Error('Nothing to run.')
    const script =
      mode === 'statement' && typeof offset === 'number'
        ? pickStatement(text, offset, profile.driver).text
        : text
    if (!script.trim()) throw new Error('No statement at the cursor.')
    const target = this.panel.results(context.panel.id)
    target.lastRequest = request
    // Not awaited: a long query outlives Orca's 120 s request limit; results arrive as pushes.
    void this.queries!.run(
      profile,
      script,
      typeof database === 'string' ? database : undefined,
      target,
      typeof notice === 'string' ? notice : undefined,
    )
  }

  private welcomeAction(action: WelcomeAction, fromEditor: boolean): void {
    switch (action) {
      case 'new-connection':
        // From an editor tab the form shows in the sidebar, which the worker cannot open.
        this.openForm()
        if (fromEditor) this.ui.showInfo('The new connection form is in the Bulkhead panel.')
        break
      case 'connect-agent':
        this.ui.showInfo('Run "Bulkhead: Connect an AI Agent" from the command palette.')
        break
      default:
        // Links open in the panel, which has the click; the rest is VS Code only.
        break
    }
  }

  /** What to add to an agent so it reaches Bulkhead in Orca through the stdio bridge. */
  private agentSetup(): string {
    const bridge = this.agents?.bridgePath ?? join(this.options.storageDir, 'bridge.js')
    // The bridge runs on Orca's own Node (the plugin helper), so the user needs no Node.
    const node = process.execPath
    const entry = {
      command: node,
      args: [bridge],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
    const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
    return [
      'Claude Code:',
      `claude mcp add --scope user bulkhead-orca -e ELECTRON_RUN_AS_NODE=1 -- ${quote(node)} ${quote(bridge)}`,
      '',
      'Other MCP clients (mcp.json):',
      JSON.stringify({ mcpServers: { 'bulkhead-orca': entry } }, null, 2),
      '',
      this.agents?.running
        ? `The server is running (port ${this.agents.running.port}).`
        : 'The server is not running; see orca plugin logs.',
    ]
      .join('\n')
      .replace(homedir(), '~')
  }

  private async updateStatus(): Promise<void> {
    const manager = this.manager
    const unlocked = this.store
      ?.list()
      .profiles.some(
        (profile) => profile.production && manager?.accessMode(profile) === 'read-write',
      )
    const server = this.agents?.running
    const params: JsonValue = unlocked
      ? {
          id: 'status',
          text: 'Bulkhead · PROD WRITES UNLOCKED',
          tone: 'danger',
          tooltip: 'A production connection accepts writes until you lock it or disconnect.',
        }
      : {
          id: 'status',
          text: server ? 'Bulkhead' : 'Bulkhead · MCP off',
          tone: server ? 'neutral' : 'warning',
          tooltip: server
            ? `MCP for AI agents on 127.0.0.1:${server.port}. Click for agent setup.`
            : 'The MCP server for AI agents did not start; see orca plugin logs.',
        }
    // Headless runs (`orca plugin check`) have no status bar.
    await this.orca.host
      .call('statusBar.update', params)
      .catch((error: unknown) => this.orca.log(`statusBar.update: ${describeError(error)}`))
  }

  private tabs?: Promise<Workspace>

  /** One lookup at a time, so two quick clicks never add the folder twice. */
  private tabsWorkspace(): Promise<Workspace> {
    this.tabs ??= tabsWorkspace(
      this.orca.host,
      join(this.options.storageDir, TABS_FOLDER),
      this.options.addFolder ?? orcaCliAddFolder(),
    )
    const pending = this.tabs
    // A failed lookup is retried on the next open; a found workspace is checked again then too,
    // in case the user removed it from Orca.
    void pending.finally(() => {
      if (this.tabs === pending) this.tabs = undefined
    })
    return pending
  }

  private async openTab(workspace: Workspace, path: string): Promise<void> {
    await this.orca.host.call('workspace.open', { workspaceId: workspace.id })
    await this.orca.host.call('editor.open', { workspaceId: workspace.id, path })
  }

  private profile(id: unknown): ConnectionProfile {
    const profile = typeof id === 'string' ? this.store!.get(id) : undefined
    if (!profile) throw new Error('That connection no longer exists.')
    return profile
  }
}

/** Nodes come back from the panel; only the shape is checked, the driver reads its context. */
function checkNode(node: ExplorerNode): ExplorerNode {
  if (typeof node.id !== 'string' || typeof node.kind !== 'string') throw new Error('Bad node')
  return node
}
