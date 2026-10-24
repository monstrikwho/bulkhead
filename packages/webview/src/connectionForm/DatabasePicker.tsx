import {
  catalogEntryForHost,
  searchCatalog,
  type CatalogEntry,
  type ParseResult,
} from '@bulkhead/core'
import { useEffect, useRef, useState } from 'react'

import { DatabaseIcon } from './DatabaseIcon'
import { Icon } from '../icons'
import { looksLikeConnectionString, parseConnectionString } from './hostRequests'

type Detected = { text: string; result: ParseResult | null }

interface Props {
  onPick: (entry: CatalogEntry) => void
  onParsed: (parsed: Extract<ParseResult, { ok: true }>) => void
}

/** First screen of a new connection: search the catalog or paste a connection string. */
export function DatabasePicker({ onPick, onParsed }: Props) {
  const [query, setQuery] = useState('')
  const [detected, setDetected] = useState<Detected>()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  const isConnectionString = looksLikeConnectionString(query)
  const matches = isConnectionString ? [] : searchCatalog(query)
  const available = matches.filter((entry) => entry.driver)
  const planned = matches.filter((entry) => !entry.driver)
  const current = detected?.text === query ? detected.result : undefined

  const change = (text: string) => {
    setQuery(text)
    if (!looksLikeConnectionString(text)) return
    void parseConnectionString(text).then((result) => {
      setDetected({ text, result })
    })
  }

  const submit = () => {
    if (current?.ok) onParsed(current)
    else if (!isConnectionString && available.length === 1) onPick(available[0]!)
  }

  return (
    <div className="cf-page">
      <div className="cf-search">
        <Icon name="search" className="muted" />
        <input
          ref={input}
          value={query}
          placeholder="Search databases or paste a connection string…"
          aria-label="Search databases or paste a connection string"
          spellCheck={false}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        <kbd>Enter</kbd>
      </div>
      <SearchHint
        query={query}
        isConnectionString={isConnectionString}
        result={current}
        matches={available.length}
      />

      {available.length > 0 && (
        <section className="cf-section">
          <h2>{query ? 'Matches' : 'PostgreSQL and compatible'}</h2>
          <div className="cf-tiles">
            {available.map((entry) => (
              <button
                key={entry.id}
                className="cf-tile"
                onClick={() => onPick(entry)}
                title={entry.label}
              >
                <DatabaseIcon id={entry.id} label={entry.label} size={34} />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {planned.length > 0 && (
        <section className="cf-section">
          <h2>Planned</h2>
          <div className="cf-tiles">
            {planned.map((entry) => (
              <div
                key={entry.id}
                className="cf-tile disabled"
                aria-disabled
                title={`${entry.label}: not supported yet`}
              >
                <DatabaseIcon id={entry.id} label={entry.label} size={34} />
                <span>{entry.label}</span>
                <span className="cf-badge">Planned</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isConnectionString && matches.length === 0 && (
        <p className="muted cf-empty">
          Nothing matches “{query}”. Bulkhead supports PostgreSQL today; ClickHouse, Redis and
          RabbitMQ are next.
        </p>
      )}
    </div>
  )
}

function SearchHint({
  query,
  isConnectionString,
  result,
  matches,
}: {
  query: string
  isConnectionString: boolean
  result: ParseResult | null | undefined
  matches: number
}) {
  if (isConnectionString) {
    if (result === undefined) return <p className="cf-hint muted">Reading the connection string…</p>
    if (result === null)
      return <p className="cf-hint error">Not a connection string Bulkhead can open.</p>
    if (!result.ok) return <p className="cf-hint error">{result.message}</p>
    const target = [result.options.host, result.options.database].filter(Boolean).join(' / ')
    const service = catalogEntryForHost(result.options.host)?.label ?? 'PostgreSQL'
    return (
      <p className="cf-hint ok">
        {service} connection{target ? ` to ${String(target)}` : ''} · <b>Enter</b> fills in the form
      </p>
    )
  }
  return (
    <p className="cf-hint muted">
      Type to search or paste a connection string to fill in the form
      {query && matches === 1 ? (
        <>
          {' '}
          · <b>Enter</b> opens the only match
        </>
      ) : null}
    </p>
  )
}
