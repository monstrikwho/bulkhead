import { join } from 'node:path'

import type { AgentAccess } from '@bulkhead/host'
import * as vscode from 'vscode'

const SETTING = 'bulkhead.mcp.enabled'
const PROVIDER_ID = 'bulkhead.mcp'

/** Where `AgentAccess` keeps the bridge and the instance files; existing agent configs use it. */
export function agentStorageDir(context: vscode.ExtensionContext): string {
  return join(context.globalStorageUri.fsPath, 'mcp')
}

export function bridgeSource(context: vscode.ExtensionContext): string {
  return join(context.extensionUri.fsPath, 'dist', 'mcp-bridge.js')
}

export function extensionVersion(context: vscode.ExtensionContext): string {
  return (context.extension.packageJSON as { version?: string }).version ?? '0.0.0'
}

export function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
}

/**
 * The VS Code side of agent access (ADR 0006): the server follows `bulkhead.mcp.enabled`,
 * VS Code's own agents find it through the MCP server definition provider, and **Bulkhead:
 * Connect an AI Agent…** sets up agents outside VS Code. The server and its tools are
 * `AgentAccess` in `@bulkhead/host`.
 */
export class VsCodeAgentAccess implements vscode.Disposable {
  /** VS Code's own emitter: the MCP provider API may pass `thisArgs` and `disposables`. */
  private readonly changed = new vscode.EventEmitter<void>()
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly access: AgentAccess,
  ) {
    this.disposables.push(
      this.changed,
      access.onDidChange(() => this.changed.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(SETTING)) void this.update()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => access.writeInstance()),
    )
    this.registerProvider()
  }

  /** Starts or stops the server to match the setting. */
  async update(): Promise<void> {
    await this.access.setEnabled(vscode.workspace.getConfiguration().get<boolean>(SETTING, true))
  }

  /** `Bulkhead: Connect an AI Agent…`: the line or JSON to add Bulkhead to an agent. */
  async connectAgent(): Promise<void> {
    if (!this.access.running) {
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
    const bridge = this.access.bridgePath
    const env = { ELECTRON_RUN_AS_NODE: '1' }
    if (picked === claude) {
      const line = [
        'claude mcp add bulkhead --scope user --env ELECTRON_RUN_AS_NODE=1 --',
        quote(command),
        quote(bridge),
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
      { mcpServers: { bulkhead: { command, args: [bridge], env } } },
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
    this.access.dispose()
    for (const disposable of this.disposables) disposable.dispose()
  }

  /** VS Code 1.101+ only; older hosts and forks without the API use the bridge. */
  private registerProvider(): void {
    const api = mcpApi()
    if (!api) return
    this.disposables.push(
      api.register(PROVIDER_ID, {
        onDidChangeMcpServerDefinitions: this.changed.event,
        provideMcpServerDefinitions: () => {
          const server = this.access.running
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
