import { randomUUID } from 'node:crypto'

import {
  splitStatements,
  statementAt,
  type ConnectionProfile,
  type DriverKind,
} from '@bulkhead/core'

import type { ConnectionManager } from '../connections/manager'
import { driverFor } from '../drivers'
import { CancellationError, type HostUi, type Localize, type ResultsTarget } from '../ports'

interface ActiveRun {
  id: string
  controller: AbortController
}

export interface QueryRunnerOptions {
  /** Where runs go when the caller names no target, e.g. the results panel. */
  results: ResultsTarget
  /** Read on every run, so a changed setting applies to the next one. */
  maxRows(): number
  ui: HostUi
  t: Localize
}

/**
 * Runs SQL into the results panel and table queries into their tabs: one run at a time per
 * target, so a slow table does not block the editor.
 */
export class QueryRunner {
  private readonly active = new Map<ResultsTarget, ActiveRun>()

  constructor(
    private readonly manager: ConnectionManager,
    private readonly options: QueryRunnerOptions,
  ) {}

  async run(
    profile: ConnectionProfile,
    script: string,
    database?: string,
    target: ResultsTarget = this.options.results,
  ): Promise<void> {
    const { ui, t } = this.options
    if (this.active.has(target)) {
      ui.showWarning(t('A query is already running. Cancel it first.'))
      return
    }
    const run: ActiveRun = { id: randomUUID(), controller: new AbortController() }
    this.active.set(target, run)
    await target.reveal()

    try {
      const session = await this.manager.session(profile)
      target.post({
        type: 'run-started',
        runId: run.id,
        connection: {
          name: profile.name,
          database,
          production: profile.production,
          accessMode: session.accessMode,
        },
        script,
        startedAt: Date.now(),
      })
      const outcomes = await session.execute(script, {
        maxRows: this.options.maxRows(),
        database,
        signal: run.controller.signal,
      })
      target.post({ type: 'run-finished', runId: run.id, outcomes, finishedAt: Date.now() })
    } catch (error) {
      if (error instanceof CancellationError) return
      const message = error instanceof Error ? error.message : String(error)
      target.post({ type: 'run-failed', runId: run.id, message, finishedAt: Date.now() })
      ui.showError(t('{0}: {1}', profile.name, message))
    } finally {
      this.active.delete(target)
    }
  }

  /** Cancels the run with this id, or without one the run in the default target. */
  cancel(runId?: string): void {
    const run =
      runId === undefined
        ? this.active.get(this.options.results)
        : [...this.active.values()].find((active) => active.id === runId)
    run?.controller.abort()
  }
}

export interface PickedStatement {
  text: string
  /** Offsets of the statement in the text; absent when the whole text is sent. */
  range?: { start: number; end: number }
}

/**
 * The statement under the cursor (`offset`), found with the driver's dialect. Drivers without a
 * dialect get the whole text; an offset between statements gets an empty text.
 */
export function pickStatement(text: string, offset: number, kind: DriverKind): PickedStatement {
  const { dialect } = driverFor(kind)
  if (!dialect) return { text }
  const statement = statementAt(splitStatements(text, dialect), offset)
  if (!statement) return { text: '' }
  return { text: statement.text, range: { start: statement.start, end: statement.end } }
}
