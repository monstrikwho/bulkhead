import type { ConnectionProfile } from '@bulkhead/core'
import { pickStatement, type QueryRunner } from '@bulkhead/host'
import * as vscode from 'vscode'

import type { EditorBindings } from './editorBindings'

/** Runs SQL from the active editor through the shared `QueryRunner` into the results panel. */
export class EditorRunner {
  constructor(
    private readonly runner: QueryRunner,
    private readonly bindings: EditorBindings,
  ) {}

  /** Runs the selection, or the statement under the cursor (`scope: 'statement'`), or all. */
  async runEditor(scope: 'statement' | 'script'): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const bound = await this.bindings.resolve(editor.document)
    if (!bound) return

    const script = scriptToRun(editor, scope, bound.profile)
    if (!script.trim()) return
    await this.runner.run(bound.profile, script, bound.binding.database)
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

  const picked = pickStatement(text, document.offsetAt(selection.active), profile.driver)
  if (picked.range) {
    flash(
      editor,
      new vscode.Range(
        document.positionAt(picked.range.start),
        document.positionAt(picked.range.end),
      ),
    )
  }
  return picked.text
}

const flashDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
})

/** Briefly highlights what was sent, without touching the user's selection. */
function flash(editor: vscode.TextEditor, range: vscode.Range): void {
  editor.setDecorations(flashDecoration, [range])
  setTimeout(() => editor.setDecorations(flashDecoration, []), 500)
}
