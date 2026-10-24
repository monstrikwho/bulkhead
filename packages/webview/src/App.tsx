import type { ConnectionBadge, HostToWebview, StatementOutcome } from '@bulkhead/core'
import { useEffect, useState } from 'react'

import { ResultGrid } from './ResultGrid'
import { Welcome } from './Welcome'
import { toJson, toTsv } from './copy'
import { Icon } from './icons'
import { onMessage, post } from './vscode'

type Run = {
  runId: string
  connection: ConnectionBadge
  script: string
  startedAt: number
} & (
  | { status: 'running' }
  | { status: 'done'; outcomes: StatementOutcome[]; finishedAt: number }
  | { status: 'failed'; message: string; finishedAt: number }
)

/**
 * `results`: the bottom panel, for queries run from SQL editors. `table`: one table's data in an
 * editor tab, which can be refreshed.
 */
export function App({ variant }: { variant: 'results' | 'table' }) {
  const [run, setRun] = useState<Run>()
  const [tab, setTab] = useState(0)

  useEffect(() => {
    const unsubscribe = onMessage((message: HostToWebview) => {
      switch (message.type) {
        case 'run-started':
          setRun({ ...message, status: 'running' })
          setTab(0)
          break
        case 'run-finished':
          setRun((current) =>
            current?.runId === message.runId
              ? {
                  ...current,
                  status: 'done',
                  outcomes: message.outcomes,
                  finishedAt: message.finishedAt,
                }
              : current,
          )
          // Land on the error, or on the last result: that is what the user is waiting for.
          setTab(Math.max(0, message.outcomes.length - 1))
          break
        case 'run-failed':
          setRun((current) =>
            current?.runId === message.runId
              ? {
                  ...current,
                  status: 'failed',
                  message: message.message,
                  finishedAt: message.finishedAt,
                }
              : current,
          )
          break
      }
    })
    post({ type: 'ready' })
    return unsubscribe
  }, [])

  if (!run) return variant === 'table' ? <div className="running">Loading…</div> : <Welcome />

  return (
    <div className="app">
      <Header run={run} refreshable={variant === 'table'} />
      {run.status === 'running' && <div className="running">Running…</div>}
      {run.status === 'failed' && <div className="error-box">{run.message}</div>}
      {run.status === 'done' && <Outcomes outcomes={run.outcomes} tab={tab} onTab={setTab} />}
    </div>
  )
}

function Header({ run, refreshable }: { run: Run; refreshable: boolean }) {
  const { connection } = run
  const unlocked = connection.accessMode === 'read-write'
  const badge = connection.production
    ? unlocked
      ? 'PROD · WRITES UNLOCKED'
      : 'PROD · read-only'
    : unlocked
      ? null
      : 'read-only'
  const target = connection.database
    ? `${connection.name} / ${connection.database}`
    : connection.name

  return (
    <header className={connection.production ? 'header prod' : 'header'}>
      {badge && <span className={unlocked ? 'badge danger' : 'badge'}>{badge}</span>}
      <span className="target">{target}</span>
      <span className="spacer" />
      {run.status === 'running' ? (
        <>
          <Elapsed since={run.startedAt} />
          <button type="button" onClick={() => post({ type: 'cancel', runId: run.runId })}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="muted">{formatDuration(run.finishedAt - run.startedAt)}</span>
          {refreshable && (
            <button
              type="button"
              className="secondary icon-button"
              onClick={() => post({ type: 'refresh' })}
            >
              <Icon name="refresh" />
              Refresh
            </button>
          )}
        </>
      )}
    </header>
  )
}

function Outcomes(props: {
  outcomes: StatementOutcome[]
  tab: number
  onTab: (index: number) => void
}) {
  const { outcomes, tab, onTab } = props
  if (outcomes.length === 0) return <div className="empty">Nothing to run.</div>
  const current = outcomes[Math.min(tab, outcomes.length - 1)]!

  return (
    <>
      {outcomes.length > 1 && (
        <div className="tabs" role="tablist">
          {outcomes.map((outcome, index) => (
            <button
              type="button"
              key={index}
              role="tab"
              aria-selected={index === tab}
              className={outcome.kind === 'error' ? 'tab error' : 'tab'}
              title={outcome.statement}
              onClick={() => onTab(index)}
            >
              {index + 1}. {tabLabel(outcome)}
            </button>
          ))}
        </div>
      )}
      <OutcomeView key={tab} outcome={current} />
    </>
  )
}

function OutcomeView({ outcome }: { outcome: StatementOutcome }) {
  switch (outcome.kind) {
    case 'rows':
      return (
        <>
          <ResultGrid columns={outcome.columns} rows={outcome.rows} />
          <footer className="footer">
            <span>
              {outcome.rows.length.toLocaleString()} rows
              {outcome.truncated && (
                <span className="warning"> · row limit reached, more rows on the server</span>
              )}
            </span>
            <span className="muted">{formatDuration(outcome.durationMs)}</span>
            <span className="spacer" />
            <button
              type="button"
              className="secondary"
              onClick={() => post({ type: 'copy', text: toTsv(outcome.columns, outcome.rows) })}
            >
              Copy TSV
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => post({ type: 'copy', text: toJson(outcome.columns, outcome.rows) })}
            >
              Copy JSON
            </button>
          </footer>
        </>
      )
    case 'command':
      return (
        <div className="message">
          {outcome.command || 'OK'}
          {outcome.rowCount !== null && ` · ${outcome.rowCount.toLocaleString()} rows affected`}
          <span className="muted"> · {formatDuration(outcome.durationMs)}</span>
        </div>
      )
    case 'error':
      return (
        <div className={outcome.blockedBy ? 'error-box blocked' : 'error-box'}>
          {outcome.blockedBy && <strong>Read-only mode</strong>}
          <div>{outcome.message}</div>
          {outcome.code && <div className="muted">SQLSTATE {outcome.code}</div>}
          <pre className="statement">{outcome.statement}</pre>
        </div>
      )
  }
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  return <span className="muted">{formatDuration(now - since)}</span>
}

function tabLabel(outcome: StatementOutcome): string {
  switch (outcome.kind) {
    case 'rows':
      return `${outcome.rows.length.toLocaleString()} rows`
    case 'command':
      return outcome.command || 'OK'
    case 'error':
      return outcome.blockedBy ? 'Blocked' : 'Error'
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}
