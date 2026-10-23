import {
  CATALOG,
  catalogEntryForHost,
  type CatalogEntry,
  type ConnectionDraft,
  type DriverDescriptor,
  type FormHostToWebview,
  type ParseResult,
} from '@bulkhead/core'
import { useEffect, useState } from 'react'

import { onMessage, post } from '../vscode'
import { ConnectionForm, type FormStart } from './ConnectionForm'
import { DatabasePicker } from './DatabasePicker'
import { settle } from './hostRequests'

type Screen = { name: 'loading' } | { name: 'picker' } | { name: 'form'; start: FormStart }

export function ConnectionFormApp() {
  const [drivers, setDrivers] = useState<DriverDescriptor[]>([])
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  const [saveError, setSaveError] = useState<string>()

  useEffect(() => {
    const unsubscribe = onMessage((message: FormHostToWebview) => {
      if (settle(message)) return
      if (message.type === 'init') {
        setDrivers(message.drivers)
        const existing = message.existing
        setScreen(
          existing
            ? {
                name: 'form',
                start: {
                  entry: entryFor(existing.draft.driver, existing.draft.options.host),
                  draft: existing.draft,
                  savedSecrets: existing.savedSecrets,
                },
              }
            : { name: 'picker' },
        )
      } else if (message.type === 'save-failed') {
        setSaveError(message.message)
      }
    })
    post({ type: 'ready' })
    return unsubscribe
  }, [])

  const driverOf = (kind: string) => drivers.find((driver) => driver.kind === kind)

  const openEntry = (entry: CatalogEntry, parsed?: Extract<ParseResult, { ok: true }>) => {
    const driver = entry.driver && driverOf(entry.driver)
    if (!driver) return
    const defaults = Object.fromEntries(
      driver.optionFields.flatMap((field) =>
        field.default === undefined ? [] : [[field.key, field.default]],
      ),
    )
    setSaveError(undefined)
    setScreen({
      name: 'form',
      start: {
        entry,
        draft: {
          name: '',
          driver: driver.kind,
          production: false,
          readOnly: false,
          options: { ...defaults, ...entry.defaults, ...parsed?.options },
          secrets: { ...parsed?.secrets },
        },
        savedSecrets: [],
      },
    })
  }

  switch (screen.name) {
    case 'loading':
      return <div className="cf-loading muted">Loading…</div>
    case 'picker':
      return (
        <DatabasePicker
          onPick={(entry) => openEntry(entry)}
          onParsed={(parsed) => openEntry(entryFor(parsed.driver, parsed.options.host), parsed)}
        />
      )
    case 'form': {
      const driver = driverOf(screen.start.draft.driver)
      if (!driver) return <div className="cf-loading">Unknown driver.</div>
      return (
        <ConnectionForm
          // A new start (another database, a pasted string) resets the form.
          key={JSON.stringify(screen.start)}
          driver={driver}
          start={screen.start}
          saveError={saveError}
          onBack={screen.start.draft.id ? undefined : () => setScreen({ name: 'picker' })}
          onSave={(draft: ConnectionDraft) => {
            setSaveError(undefined)
            post({ type: 'save', draft })
          }}
          onCancel={() => post({ type: 'cancel' })}
        />
      )
    }
  }
}

/**
 * The service a host belongs to (Neon for `*.neon.tech`), otherwise the plain driver entry, e.g.
 * PostgreSQL for a pasted postgres:// URL or an edited profile.
 */
function entryFor(driver: string, host: unknown): CatalogEntry {
  const service = catalogEntryForHost(host)
  if (service?.driver === driver) return service
  return CATALOG.find((entry) => entry.id === driver) ?? CATALOG[0]!
}
