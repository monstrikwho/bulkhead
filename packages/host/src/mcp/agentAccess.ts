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

import {
  describeDriver,
  describeError,
  saveDraft,
  savedDraft,
  testDraft,
  type DraftDependencies,
} from '../connections/drafts'
import { driverFor, drivers } from '../drivers'
import { Emitter, type Disposable } from '../events'
import type { HostUi } from '../ports'
import { removeInstance, writeInstance } from './discovery'
import {
  startMcpServer,
  type AgentTools,
  type ConnectionSummary,
  type RunningMcpServer,
} from './server'

export interface AgentAccessOptions {
  deps: DraftDependencies
  ui: HostUi
  /**
   * Holds the bridge copy and the instance files. Must not change with the host's version:
   * agents keep the bridge path in their config (VS Code: `<globalStorage>/mcp`).
   */
  storageDir: string
  /** The built stdio bridge (`dist/mcp-bridge.js`) copied into `storageDir` on start. */
  bridgeSource: string
  /** The host's version, reported to agents. */
  version: string
  /** Folders open in this window, so the bridge picks the window an agent works in. */
  workspaceFolders(): string[]
}

/**
 * AI agents talk to Bulkhead over MCP (ADR 0006). Each window runs a local server while agent
 * access is enabled; agents outside the editor start the stdio bridge, which finds it through an
 * instance file. The tools read profiles, open the connection form, test and save (ADR 0007);
 * they never return a saved secret, and weakening protection always goes through the form.
 * How in-editor agents discover the server is the host adapter's business.
 */
export class AgentAccess implements Disposable {
  private server: RunningMcpServer | undefined
  private starting: Promise<void> | undefined
  private readonly changed = new Emitter<void>()
  /** Fires when the server starts or stops. */
  readonly onDidChange = this.changed.event
  private readonly instances: string
  /** Where the bridge is copied: the path agents are configured with. */
  readonly bridgePath: string

  constructor(private readonly options: AgentAccessOptions) {
    this.instances = join(options.storageDir, 'instances')
    this.bridgePath = join(options.storageDir, 'bridge.js')
  }

  /** The running server, if any. */
  get running(): RunningMcpServer | undefined {
    return this.server
  }

  /** Starts or stops the server; waits for a start in progress first. */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.starting
    if (enabled && !this.server) {
      this.starting = this.start()
      await this.starting
    } else if (!enabled && this.server) {
      await this.stop()
    }
  }

  /** Rewrites the instance file, e.g. after the workspace folders changed. */
  writeInstance(): void {
    if (!this.server) return
    writeInstance(this.instances, {
      pid: process.pid,
      port: this.server.port,
      token: this.server.token,
      workspaceFolders: this.options.workspaceFolders(),
      startedAt: Date.now(),
    })
  }

  dispose(): void {
    void this.stop()
    this.changed.dispose()
  }

  private async start(): Promise<void> {
    const { ui, deps } = this.options
    try {
      // The bridge path must not change with the extension version: agents keep it in config.
      await mkdir(this.options.storageDir, { recursive: true, mode: 0o700 })
      await copyFile(this.options.bridgeSource, this.bridgePath)
      this.server = await startMcpServer(this.tools(), this.options.version)
      this.writeInstance()
      this.changed.fire()
    } catch (error) {
      ui.showWarning(deps.t('Bulkhead could not start AI agent access: {0}', describeError(error)))
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

  private tools(): AgentTools {
    const { deps, ui } = this.options
    const { store, t } = deps
    return {
      optionsHelp: describeDriverOptions([...drivers.values()].map(describeDriver)),
      listConnections: () => Promise.resolve(store.list().profiles.map(summarize)),
      configureConnection: async (proposal) => {
        const { existing, proposed } = await this.prepare(proposal)
        ui.openConnectionForm(existing, proposed)

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
        const result = await testDraft(deps, proposed.draft, existing)
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
        const profile = await saveDraft(deps, proposed.draft, existing)
        // Saved without the form, so the user still learns about it.
        ui.showInfo(
          existing
            ? t('An AI agent changed the connection “{0}”.', profile.name)
            : t('An AI agent added the connection “{0}”.', profile.name),
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
    const { store, secrets } = this.options.deps
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
