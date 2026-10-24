import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ConfigError,
  describeDriverOptions,
  proposeDraft,
  type ConnectionProfile,
  type ConnectionProposal,
  type ProposedDraft,
} from '@bulkhead/core'
import * as vscode from 'vscode'

import { describeError, saveDraft, testDraft } from '../connections/drafts'
import {
  ConnectionFormPanel,
  describeDriver,
  savedDraft,
  type FormDependencies,
} from '../connections/formPanel'
import { driverFor, drivers } from '../drivers'
import { removeInstance, writeInstance } from './discovery'
import {
  startMcpServer,
  type AgentTools,
  type ConnectionSummary,
  type RunningMcpServer,
} from './server'

const SETTING = 'bulkhead.mcp.enabled'
const PROVIDER_ID = 'bulkhead.mcp'

/**
 * AI agents talk to Bulkhead over MCP (ADR 0006). Each window runs a local server while
 * `bulkhead.mcp.enabled` is on. VS Code's own agents find it through the MCP server definition
 * provider; agents outside VS Code start the stdio bridge, which finds it through an instance
 * file. The tools read profiles, open the connection form, test and save (ADR 0007); they never
 * return a saved secret, and weakening protection always goes through the form.
 */
export class AgentAccess implements vscode.Disposable {
  private server: RunningMcpServer | undefined
  private starting: Promise<void> | undefined
  private readonly changed = new vscode.EventEmitter<void>()
  private readonly disposables: vscode.Disposable[] = []
  private readonly root: string
  private readonly instances: string
  private readonly bridge: string

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: FormDependencies,
  ) {
    this.root = join(context.globalStorageUri.fsPath, 'mcp')
    this.instances = join(this.root, 'instances')
    this.bridge = join(this.root, 'bridge.js')
    this.disposables.push(
      this.changed,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(SETTING)) void this.update()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.writeInstance()),
    )
    this.registerProvider()
  }

  /** Starts or stops the server to match the setting. */
  async update(): Promise<void> {
    await this.starting
    const enabled = vscode.workspace.getConfiguration().get<boolean>(SETTING, true)
    if (enabled && !this.server) {
      this.starting = this.start()
      await this.starting
    } else if (!enabled && this.server) {
      await this.stop()
    }
  }

  /** `Bulkhead: Connect an AI Agent…`: the line or JSON to add Bulkhead to an agent. */
  async connectAgent(): Promise<void> {
    if (!this.server) {
      const enable = vscode.l10n.t('Enable')
      const answer = await vscode.window.showInformationMessage(
        vscode.l10n.t('AI agent access is turned off ({0}).', SETTING),
        enable,
      )
      if (answer !== enable) return
      await vscode.workspace
        .getConfiguration()
        .update(SETTING, true, vscode.ConfigurationTarget.Global)
      await this.update()
    }

    const claude = {
      label: 'Claude Code',
      detail: vscode.l10n.t('Adds Bulkhead to Claude Code for your user, in every project.'),
    }
    const other = {
      label: vscode.l10n.t('Cursor, Windsurf, Codex and other MCP clients'),
      detail: vscode.l10n.t('Copies the server entry for the client’s mcp.json.'),
    }
    const copilot = {
      label: 'GitHub Copilot',
      detail: vscode.l10n.t('Needs nothing: VS Code lists Bulkhead under MCP servers.'),
    }
    const items = providerSupported() ? [claude, other, copilot] : [claude, other]
    const picked = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t('Connect an AI Agent to Bulkhead'),
      placeHolder: vscode.l10n.t('Agent'),
    })
    if (!picked || picked === copilot) return

    const command = process.execPath
    const env = { ELECTRON_RUN_AS_NODE: '1' }
    if (picked === claude) {
      const line = [
        'claude mcp add bulkhead --scope user --env ELECTRON_RUN_AS_NODE=1 --',
        quote(command),
        quote(this.bridge),
      ].join(' ')
      const run = vscode.l10n.t('Run in Terminal')
      const copy = vscode.l10n.t('Copy')
      const answer = await vscode.window.showInformationMessage(
        vscode.l10n.t('Add Bulkhead to Claude Code, then restart Claude Code.'),
        { modal: true, detail: line },
        run,
        copy,
      )
      if (answer === run) {
        const terminal = vscode.window.createTerminal({ name: 'Bulkhead MCP' })
        terminal.show()
        terminal.sendText(line)
      } else if (answer === copy) {
        await vscode.env.clipboard.writeText(line)
      }
      return
    }

    const entry = JSON.stringify(
      { mcpServers: { bulkhead: { command, args: [this.bridge], env } } },
      null,
      2,
    )
    await vscode.env.clipboard.writeText(entry)
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        'Copied. Merge it into the MCP configuration of your agent (Cursor: ~/.cursor/mcp.json) and restart the agent.',
      ),
    )
  }

  dispose(): void {
    void this.stop()
    for (const disposable of this.disposables) disposable.dispose()
  }

  private async start(): Promise<void> {
    try {
      // The bridge path must not change with the extension version: agents keep it in config.
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      await copyFile(join(this.context.extensionUri.fsPath, 'dist', 'mcp-bridge.js'), this.bridge)
      const version = extensionVersion(this.context)
      this.server = await startMcpServer(this.tools(), version)
      this.writeInstance()
      this.changed.fire()
    } catch (error) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('Bulkhead could not start AI agent access: {0}', describeError(error)),
      )
    } finally {
      this.starting = undefined
    }
  }

  private async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    removeInstance(this.instances, process.pid)
    this.changed.fire()
    await server.close()
  }

  private writeInstance(): void {
    if (!this.server) return
    writeInstance(this.instances, {
      pid: process.pid,
      port: this.server.port,
      token: this.server.token,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(
        (folder) => folder.uri.fsPath,
      ),
      startedAt: Date.now(),
    })
  }

  /** VS Code 1.101+ only; older hosts and forks without the API use the bridge. */
  private registerProvider(): void {
    const api = mcpApi()
    if (!api) return
    this.disposables.push(
      api.register(PROVIDER_ID, {
        onDidChangeMcpServerDefinitions: this.changed.event,
        provideMcpServerDefinitions: () => {
          const server = this.server
          if (!server) return []
          const version = extensionVersion(this.context)
          return [
            new api.HttpDefinition(
              'Bulkhead',
              vscode.Uri.parse(server.url),
              { Authorization: `Bearer ${server.token}` },
              version,
            ),
          ]
        },
      }),
    )
  }

  private tools(): AgentTools {
    const { store } = this.deps
    return {
      optionsHelp: describeDriverOptions([...drivers.values()].map(describeDriver)),
      listConnections: () => Promise.resolve(store.list().profiles.map(summarize)),
      configureConnection: async (proposal) => {
        const { existing, proposed } = await this.prepare(proposal)
        ConnectionFormPanel.show(this.deps, existing, proposed)

        const lines = [
          existing
            ? `Opened the form of "${existing.name}" in VS Code with your changes.`
            : 'Opened the new connection form in VS Code, filled in.',
          'Nothing is saved yet: the user checks the fields, types the password if needed and ' +
            'saves. Tell them so; call list_connections later to see the result.',
        ]
        if (existing) {
          lines.push(
            proposed.changed.length
              ? `Changed: ${proposed.changed.join(', ')}.`
              : 'Nothing differs from the saved connection.',
          )
        }
        lines.push(...proposed.warnings)
        return lines.join('\n')
      },
      testConnection: async (proposal) => {
        const { existing, proposed } = await this.prepare(proposal)
        const result = await testDraft(this.deps, proposed.draft, existing)
        if (!result.ok) throw new Error(`Could not connect: ${result.message}`)
        const databases = result.databases.length ? result.databases.join(', ') : 'none visible'
        return `Connected read-only in ${result.durationMs} ms. Databases: ${databases}.`
      },
      saveConnection: async (proposal) => {
        const { existing, proposed } = await this.prepare(proposal)
        if (proposed.warnings.length) {
          throw new ConfigError(
            `${proposed.warnings.join(' ')} Only the user can do that: call ` +
              'configure_connection to open the form for them.',
          )
        }
        const profile = await saveDraft(this.deps, proposed.draft, existing)
        // Saved without the form, so the user still learns about it.
        void vscode.window.showInformationMessage(
          existing
            ? vscode.l10n.t('An AI agent changed the connection “{0}”.', profile.name)
            : vscode.l10n.t('An AI agent added the connection “{0}”.', profile.name),
        )
        const summary = summarize(profile)
        return [
          `${existing ? 'Saved changes to' : 'Saved'} "${profile.name}" (id ${profile.id}): ` +
            `${summary.target}, ${summary.environment}${summary.readOnly ? ', read-only' : ''}.`,
          ...(existing && proposed.changed.length
            ? [`Changed: ${proposed.changed.join(', ')}.`]
            : []),
        ].join('\n')
      },
    }
  }

  /** The agent's values as a form draft, over the saved connection when it names one. */
  private async prepare(
    proposal: ConnectionProposal,
  ): Promise<{ existing: ConnectionProfile | undefined; proposed: ProposedDraft }> {
    const { store, secrets } = this.deps
    const existing = proposal.connectionId ? store.get(proposal.connectionId) : undefined
    if (proposal.connectionId && !existing) {
      throw new ConfigError(
        `No saved connection has id "${proposal.connectionId}"; call list_connections.`,
      )
    }
    if (existing && proposal.driver && proposal.driver !== existing.driver) {
      throw new ConfigError(
        `"${existing.name}" is a ${driverFor(existing.driver).displayName} connection; the database type of a ` +
          'saved connection cannot change. Omit connectionId to prepare a new one.',
      )
    }
    const driver = driverFor(existing?.driver ?? proposal.driver ?? 'postgres')
    const parsed = proposal.connectionString
      ? driver.parseConnectionString?.(proposal.connectionString)
      : undefined
    if (proposal.connectionString && !parsed) {
      throw new ConfigError(`Not a ${driver.displayName} connection string.`)
    }
    const proposed = proposeDraft({
      proposal,
      driver: describeDriver(driver),
      ...(existing ? { existing: (await savedDraft(existing, secrets)).draft } : {}),
      ...(parsed ? { parsed } : {}),
    })
    return { existing, proposed }
  }
}

function extensionVersion(context: vscode.ExtensionContext): string {
  return (context.extension.packageJSON as { version?: string }).version ?? '0.0.0'
}

function summarize(profile: ConnectionProfile): ConnectionSummary {
  let target: string
  try {
    const driver = driverFor(profile.driver)
    target = driver.describe(driver.parseOptions(profile.options))
  } catch (error) {
    target = `invalid: ${describeError(error)}`
  }
  return {
    id: profile.id,
    name: profile.name,
    driver: profile.driver,
    environment: profile.production ? 'production' : 'development',
    readOnly: profile.production || profile.readOnly === true,
    target,
  }
}

/** For a shell command line: POSIX shells take single quotes, cmd and PowerShell double. */
function quote(value: string): string {
  if (process.platform === 'win32') return `"${value}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * `vscode.lm.registerMcpServerDefinitionProvider` and `McpHttpServerDefinition` arrived in VS
 * Code 1.101; `@types/vscode` stays at our minimum version, so they are looked up at runtime.
 */
interface McpProvider {
  onDidChangeMcpServerDefinitions: vscode.Event<void>
  provideMcpServerDefinitions(): unknown[]
}
interface McpApi {
  register(id: string, provider: McpProvider): vscode.Disposable
  HttpDefinition: new (
    label: string,
    uri: vscode.Uri,
    headers: Record<string, string>,
    version: string,
  ) => unknown
}

function mcpApi(): McpApi | undefined {
  const lm = vscode.lm as unknown as {
    registerMcpServerDefinitionProvider?: (id: string, provider: McpProvider) => vscode.Disposable
  }
  const HttpDefinition = (
    vscode as unknown as { McpHttpServerDefinition?: McpApi['HttpDefinition'] }
  ).McpHttpServerDefinition
  const register = lm.registerMcpServerDefinitionProvider
  if (typeof register !== 'function' || typeof HttpDefinition !== 'function') return undefined
  return { register: (id, provider) => register.call(vscode.lm, id, provider), HttpDefinition }
}

function providerSupported(): boolean {
  return mcpApi() !== undefined
}
