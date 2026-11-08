import {
  formatConsoleFile,
  PANEL,
  parseConsoleFile,
  type ConsoleFile,
  type PanelState,
  type RunRequest,
} from '@bulkhead/core'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { App } from '../App'
import { Icon } from '../icons'
import { orcaFrame, type OrcaEditorSession } from './bridge'
import { AccessBadge, call, messageOf, Questions, Tooltips } from './shared'

/**
 * A SQL console in an Orca editor tab (a `.bhsql` file): the SQL on top, its results below.
 * The file's first line names the connection; the tab keeps that line and shows only the SQL.
 */
export function ConsoleApp() {
  const [file, setFile] = useState<ConsoleFile>()
  const [state, setState] = useState<PanelState>()
  const [error, setError] = useState<string>()
  const [readOnly, setReadOnly] = useState(false)
  const session = useRef<OrcaEditorSession>(undefined)
  const editor = useRef<HTMLTextAreaElement>(null)

  const refresh = useCallback(
    () =>
      call<PanelState>(PANEL.state).then(setState, (failure: unknown) =>
        setError(messageOf(failure)),
      ),
    [],
  )

  useEffect(() => {
    const frame = orcaFrame()
    const subscriptions = [frame.plugin.on(PANEL.changed, () => void refresh())]
    void refresh()
    let disposed = false
    frame.document
      ?.session({ debounceMs: 300 })
      .then((opened) => {
        if (disposed) return opened.dispose()
        session.current = opened
        setReadOnly(opened.readOnly)
        setFile(parseConsoleFile(opened.value))
        subscriptions.push(opened.onReplace((value) => setFile(parseConsoleFile(value))))
        subscriptions.push(opened)
      })
      .catch((failure: unknown) => setError(messageOf(failure)))
    return () => {
      disposed = true
      subscriptions.forEach((subscription) => subscription.dispose())
    }
  }, [refresh])

  const connection = state?.connections.find((item) => item.id === file?.connectionId)
  const update = (next: ConsoleFile) => {
    setFile(next)
    const name = state?.connections.find((item) => item.id === next.connectionId)?.name
    session.current?.change(formatConsoleFile(next, name))
  }

  const run = async (mode: RunRequest['mode']) => {
    if (!file) return
    if (!file.connectionId || !connection) {
      setError('Choose a connection for this console first.')
      return
    }
    const area = editor.current
    const selection =
      area && area.selectionStart !== area.selectionEnd
        ? file.sql.slice(area.selectionStart, area.selectionEnd)
        : undefined
    const request: RunRequest = {
      connectionId: connection.id,
      text: selection ?? file.sql,
      mode: selection ? 'script' : mode,
      ...(mode === 'statement' && !selection && area ? { offset: area.selectionStart } : {}),
    }
    setError(undefined)
    try {
      await call(PANEL.run, request)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void run(event.shiftKey ? 'script' : 'statement')
    }
  }

  const missing = file?.connectionId && state && !connection
  return (
    <div className={`oa-root oa-console ${connection?.production ? 'production' : ''}`}>
      <header className="oa-bar oa-console-bar">
        <select
          className="oa-select"
          aria-label="Connection"
          data-tip="The connection this console runs on"
          value={connection?.id ?? ''}
          onChange={(event) => file && update({ ...file, connectionId: event.target.value })}
        >
          {!connection && (
            <option value="" disabled>
              {missing ? 'Unknown connection: choose another' : 'Choose a connection…'}
            </option>
          )}
          {state?.connections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.production ? `${item.name} (PROD)` : item.name}
            </option>
          ))}
        </select>
        {connection && <AccessBadge connection={connection} />}
        <span className="spacer" />
        <button
          type="button"
          className="oa-run"
          data-tip="Run the statement at the cursor, or the selection (⌘/Ctrl+Enter)"
          onClick={() => void run('statement')}
        >
          <Icon name="play" size={14} /> Run
        </button>
        <button
          type="button"
          className="oa-run secondary"
          data-tip="Run the whole console (⌘/Ctrl+Shift+Enter)"
          onClick={() => void run('script')}
        >
          <Icon name="playAll" size={14} /> Run all
        </button>
      </header>
      <textarea
        ref={editor}
        className="oa-editor"
        value={file?.sql ?? ''}
        readOnly={!file || readOnly}
        spellCheck={false}
        placeholder="SELECT … — ⌘/Ctrl+Enter runs the statement at the cursor"
        aria-label="SQL"
        onChange={(event) => file && update({ ...file, sql: event.target.value })}
        onKeyDown={onKey}
      />
      {error && (
        <p className="oa-error" role="alert">
          <Icon name="error" size={12} />
          <span className="oa-error-text" data-tip={error}>
            {error}
          </span>
        </p>
      )}
      <section className="oa-results">
        <App variant="results" />
      </section>
      <Questions />
      <Tooltips />
    </div>
  )
}
