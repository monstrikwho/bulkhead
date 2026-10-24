import { randomUUID } from 'node:crypto'

import { splitStatements, statementAt, type ConnectionProfile } from '@bulkhead/core'
import * as vscode from 'vscode'

import type { ConnectionManager } from '../connections/manager'
import { driverFor } from '../drivers'
import type { ResultsTarget } from '../results/channel'
import type { EditorBindings } from './editorBindings'

interface ActiveRun {
  id: string
  controller: AbortController
}

/**
 * Runs SQL from editors into the results panel and table queries into their tabs: one run at a
 * time per target, so a slow table does not block the editor.
 */
export class QueryRunner {
  private readonly active = new Map<ResultsTarget, ActiveRun>()

  constructor(
    private readonly manager: ConnectionManager,
    private readonly bindings: EditorBindings,
    private readonly results: ResultsTarget,
  ) {}

  /** Runs the selection, or the statement under the cursor (`scope: 'statement'`), or all. */
  async runEditor(scope: 'statement' | 'script'): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const bound = await this.bindings.resolve(editor.document)
    if (!bound) return

    const script = scriptToRun(editor, scope, bound.profile)
    if (!script.trim()) return
    await this.run(bound.profile, script, bound.binding.database)
  }

  async run(
    profile: ConnectionProfile,
    script: string,
    database?: string,
    target: ResultsTarget = this.results,
  ): Promise<void> {
    if (this.active.has(target)) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('A query is already running. Cancel it first.'),
      )
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
      const maxRows = vscode.workspace
        .getConfiguration('bulkhead')
        .get<number>('query.maxRows', 1000)
      const outcomes = await session.execute(script, {
        maxRows,
        database,
        signal: run.controller.signal,
      })
      target.post({ type: 'run-finished', runId: run.id, outcomes, finishedAt: Date.now() })
    } catch (error) {
      if (error instanceof vscode.CancellationError) return
      const message = error instanceof Error ? error.message : String(error)
      target.post({ type: 'run-failed', runId: run.id, message, finishedAt: Date.now() })
      void vscode.window.showErrorMessage(vscode.l10n.t('{0}: {1}', profile.name, message))
    } finally {
      this.active.delete(target)
    }
  }

  /** Cancels the run with this id, or without one the run in the results panel. */
  cancel(runId?: string): void {
    const run =
      runId === undefined
        ? this.active.get(this.results)
        : [...this.active.values()].find((active) => active.id === runId)
    run?.controller.abort()
  }
}

function scriptToRun(
  editor: vscode.TextEditor,
  scope: 'statement' | 'script',
  profile: ConnectionProfile,
): string {
  const { document, selection } = editor
  if (!selection.isEmpty) return document.getText(selection)
  const text = document.getText()
  if (scope === 'script') return text

  const { dialect } = driverFor(profile.driver)
  if (!dialect) return text
  const statement = statementAt(splitStatements(text, dialect), document.offsetAt(selection.active))
  if (!statement) return ''
  flash(
    editor,
    new vscode.Range(document.positionAt(statement.start), document.positionAt(statement.end)),
  )
  return statement.text
}

const flashDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
})

/** Briefly highlights what was sent, without touching the user's selection. */
function flash(editor: vscode.TextEditor, range: vscode.Range): void {
  editor.setDecorations(flashDecoration, [range])
  setTimeout(() => editor.setDecorations(flashDecoration, []), 500)
}
