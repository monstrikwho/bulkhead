import { randomUUID } from 'node:crypto'

import { splitStatements, statementAt, type ConnectionProfile } from '@bulkhead/core'
import * as vscode from 'vscode'

import type { ConnectionManager } from '../connections/manager'
import { driverFor } from '../drivers'
import type { ResultsView } from '../results/resultsView'
import type { EditorBindings } from './editorBindings'

interface ActiveRun {
  id: string
  controller: AbortController
}

/** Runs SQL from editors and from tree actions, one run at a time, into the results view. */
export class QueryRunner {
  private active: ActiveRun | undefined

  constructor(
    private readonly manager: ConnectionManager,
    private readonly bindings: EditorBindings,
    private readonly results: ResultsView,
  ) {}

  /** Runs the selection, or the statement under the cursor (`scope: 'statement'`), or all. */
  async runEditor(scope: 'statement' | 'script'): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const target = await this.bindings.resolve(editor.document)
    if (!target) return

    const script = scriptToRun(editor, scope, target.profile)
    if (!script.trim()) return
    await this.run(target.profile, script, target.binding.database)
  }

  async run(profile: ConnectionProfile, script: string, database?: string): Promise<void> {
    if (this.active) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('A query is already running. Cancel it first.'),
      )
      return
    }
    const run: ActiveRun = { id: randomUUID(), controller: new AbortController() }
    this.active = run
    await this.results.reveal()

    try {
      const session = await this.manager.session(profile)
      this.results.post({
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
      this.results.post({ type: 'run-finished', runId: run.id, outcomes, finishedAt: Date.now() })
    } catch (error) {
      if (error instanceof vscode.CancellationError) return
      const message = error instanceof Error ? error.message : String(error)
      this.results.post({ type: 'run-failed', runId: run.id, message, finishedAt: Date.now() })
      void vscode.window.showErrorMessage(vscode.l10n.t('{0}: {1}', profile.name, message))
    } finally {
      this.active = undefined
    }
  }

  cancel(runId?: string): void {
    if (this.active && (runId === undefined || runId === this.active.id)) {
      this.active.controller.abort()
    }
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
