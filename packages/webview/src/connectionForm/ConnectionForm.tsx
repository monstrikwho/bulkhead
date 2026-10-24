import type {
  CatalogEntry,
  ConnectionDraft,
  DriverDescriptor,
  FormStartData,
  OptionField,
  ParseResult,
  TestResult,
} from '@bulkhead/core'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { DatabaseIcon } from './DatabaseIcon'
import { looksLikeConnectionString, parseConnectionString, testConnection } from './hostRequests'
import { Icon } from '../icons'

export interface FormStart extends FormStartData {
  entry: CatalogEntry
}

interface Props {
  driver: DriverDescriptor
  start: FormStart
  saveError: string | undefined
  /** Back to the picker; absent when editing. */
  onBack: (() => void) | undefined
  onSave: (draft: ConnectionDraft) => void
  onCancel: () => void
}

/** Form values as typed: numbers stay text until the draft is built. */
type Values = Record<string, string | boolean>

type TestState = { status: 'idle' } | { status: 'running' } | { status: 'done'; result: TestResult }

export function ConnectionForm({ driver, start, saveError, onBack, onSave, onCancel }: Props) {
  const { entry, draft: initial, savedSecrets, proposal } = start
  const editing = initial.id !== undefined
  const [name, setName] = useState(initial.name)
  const [production, setProduction] = useState(initial.production)
  const [readOnly, setReadOnly] = useState(initial.readOnly)
  const [values, setValues] = useState<Values>(() => toValues(driver.optionFields, initial.options))
  const [secrets, setSecrets] = useState<Record<string, string>>(initial.secrets)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [databases, setDatabases] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [paste, setPaste] = useState<{ open: boolean; text: string; error?: string }>({
    open: false,
    text: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)

  useEffect(() => nameInput.current?.focus(), [])

  const fields = driver.optionFields
  const field = (key: string) => fields.find((candidate) => candidate.key === key)
  const host = field('host')
  const port = field('port')
  const sectionOf = (item: OptionField) => item.section ?? 'connection'
  const connectionFields = fields.filter(
    (item) => sectionOf(item) === 'connection' && item !== host && item !== port,
  )
  const securityFields = fields.filter((item) => sectionOf(item) === 'security')
  const advancedFields = fields.filter((item) => sectionOf(item) === 'advanced')

  const suggestedName = suggestName(entry, driver, values)
  const missing = submitted
    ? new Set(
        fields.filter((item) => item.required && values[item.key] === '').map((item) => item.key),
      )
    : new Set<string>()

  const setValue = (key: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [key]: value }))
    setTest({ status: 'idle' })
  }

  const buildDraft = (): ConnectionDraft => ({
    ...(initial.id === undefined ? {} : { id: initial.id }),
    name: name.trim() || suggestedName,
    driver: driver.kind,
    production,
    readOnly: production || readOnly,
    // Keep options this form does not show, e.g. ones edited by hand in settings.json.
    options: { ...initial.options, ...fromValues(fields, values) },
    secrets,
  })

  const applyParsed = (result: ParseResult | null): string | undefined => {
    if (result === null) return 'Not a connection string Bulkhead can open.'
    if (!result.ok) return result.message
    if (result.driver !== driver.kind)
      return `This is a ${String(result.driver)} connection string.`
    setValues((current) => ({ ...current, ...toValues(fields, result.options, false) }))
    setSecrets((current) => ({ ...current, ...result.secrets }))
    setTest({ status: 'idle' })
    return undefined
  }

  const runTest = async () => {
    setTest({ status: 'running' })
    const result = await testConnection(buildDraft())
    setTest({ status: 'done', result })
    if (result.ok) setDatabases(result.databases)
  }

  const save = () => {
    setSubmitted(true)
    if (fields.some((item) => item.required && values[item.key] === '')) return
    onSave(buildDraft())
  }

  return (
    <div
      className={`cf-page cf-card ${production ? 'production' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
      }}
    >
      <header className="cf-header">
        {onBack && (
          <button
            className="cf-icon-button"
            onClick={onBack}
            title="Back to databases"
            aria-label="Back"
          >
            <Icon name="back" />
          </button>
        )}
        <DatabaseIcon id={entry.id} label={entry.label} size={36} />
        <div className="cf-title">
          <h1>{editing ? initial.name : entry.label}</h1>
          <span className="muted">
            {editing ? `${driver.displayName} connection` : 'New connection'}
            {production && <span className="cf-prod-badge">PRODUCTION · read-only</span>}
          </span>
        </div>
        <span className="spacer" />
        <button className="cf-link" onClick={() => setPaste({ ...paste, open: !paste.open })}>
          <Icon name="link" /> Import connection string
        </button>
      </header>

      {proposal ? (
        <AgentNotice proposal={proposal} editing={editing} />
      ) : (
        entry.hint && !editing && <p className="cf-entry-hint muted">{entry.hint}</p>
      )}

      {paste.open && (
        <div className="cf-paste">
          <input
            autoFocus
            value={paste.text}
            placeholder="postgres://user:password@host:5432/database?sslmode=require"
            spellCheck={false}
            onChange={(event) => setPaste({ open: true, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.metaKey || event.ctrlKey) return
              void parseConnectionString(paste.text).then((result) => {
                const error = applyParsed(result)
                setPaste(error ? { ...paste, error } : { open: false, text: '' })
              })
            }}
          />
          <span className={paste.error ? 'error' : 'muted'}>
            {paste.error ??
              'Enter fills in the fields below. The password goes to the secret storage.'}
          </span>
        </div>
      )}

      <div className="cf-body">
        <Row label="Name" required>
          <input
            ref={nameInput}
            value={name}
            placeholder={suggestedName}
            onChange={(event) => setName(event.target.value)}
          />
        </Row>

        {host && (
          <Row label={port ? 'Host and port' : host.label} required invalid={missing.has('host')}>
            <div
              className={`cf-host ${missing.has('host') || missing.has('port') ? 'invalid' : ''}`}
            >
              <input
                value={String(values.host ?? '')}
                placeholder={host.placeholder ?? String(host.default ?? '')}
                aria-label={host.label}
                spellCheck={false}
                onChange={(event) => setValue('host', event.target.value)}
                onPaste={(event) => {
                  const text = event.clipboardData.getData('text')
                  if (!looksLikeConnectionString(text)) return
                  event.preventDefault()
                  void parseConnectionString(text).then((result) => {
                    const error = applyParsed(result)
                    if (error) setPaste({ open: true, text, error })
                  })
                }}
              />
              {port && (
                <>
                  <span className="muted">:</span>
                  <input
                    className="cf-port"
                    value={String(values.port ?? '')}
                    placeholder={String(port.default ?? '')}
                    aria-label={port.label}
                    inputMode="numeric"
                    onChange={(event) => setValue('port', event.target.value.replace(/\D/g, ''))}
                  />
                </>
              )}
            </div>
          </Row>
        )}

        {connectionFields.map((item) => (
          <FieldRow
            key={item.key}
            field={item}
            value={values[item.key]}
            invalid={missing.has(item.key)}
            suggestions={item.key === 'database' ? databases : undefined}
            onRefresh={item.key === 'database' ? runTest : undefined}
            onChange={(value) => setValue(item.key, value)}
            after={
              item.key === 'user'
                ? driver.secretFields.map((secret) => (
                    <SecretRow
                      key={secret.key}
                      label={secret.label}
                      value={secrets[secret.key] ?? ''}
                      saved={savedSecrets.includes(secret.key)}
                      onChange={(value) => {
                        setSecrets((current) => ({ ...current, [secret.key]: value }))
                        setTest({ status: 'idle' })
                      }}
                    />
                  ))
                : null
            }
          />
        ))}

        <Section icon="shield" title="Safety">
          <Row label="Environment">
            <Segmented
              value={production ? 'production' : 'development'}
              options={[
                { value: 'development', label: 'Development' },
                { value: 'production', label: 'Production', danger: true },
              ]}
              onChange={(value) => setProduction(value === 'production')}
            />
            <p className="cf-description">
              {production
                ? 'Opens read-only and shows in red everywhere. Writes need “Unlock Writes…” and typing the connection name, and lock again on disconnect.'
                : 'Reads and writes. Choose Production for anything you must not break.'}
            </p>
          </Row>
          <Row label="Read-only">
            <Toggle
              checked={production || readOnly}
              disabled={production}
              label="Read-only"
              onChange={setReadOnly}
            />
            <p className="cf-description">
              {production
                ? 'Always on for production.'
                : 'Refuse writes on this connection too, without marking it as production.'}
            </p>
          </Row>
          {securityFields.map((item) => (
            <FieldRow
              key={item.key}
              field={item}
              value={values[item.key]}
              invalid={missing.has(item.key)}
              onChange={(value) => setValue(item.key, value)}
            />
          ))}
        </Section>

        {advancedFields.length > 0 && (
          <div className="cf-advanced">
            <button
              className="cf-disclosure"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <Icon name="chevron" className={showAdvanced ? 'open' : ''} />
              <Icon name="gear" /> Advanced
            </button>
            {showAdvanced &&
              advancedFields.map((item) => (
                <FieldRow
                  key={item.key}
                  field={item}
                  value={values[item.key]}
                  invalid={missing.has(item.key)}
                  onChange={(value) => setValue(item.key, value)}
                />
              ))}
          </div>
        )}
      </div>

      <footer className="cf-footer">
        <button
          className="cf-secondary"
          onClick={() => void runTest()}
          disabled={test.status === 'running'}
        >
          <Icon name="plug" /> {test.status === 'running' ? 'Testing…' : 'Test'}
        </button>
        <TestStatus state={test} />
        <span className="spacer" />
        <button className="cf-text-button" onClick={onCancel}>
          Cancel
        </button>
        <button className={`cf-primary ${production ? 'danger' : ''}`} onClick={save}>
          {editing ? 'Save' : 'Save connection'}
        </button>
      </footer>
      {saveError && (
        <p className="cf-save-error error" role="alert">
          <Icon name="error" /> {saveError}
        </p>
      )}
      {submitted && missing.size > 0 && (
        <p className="cf-save-error error" role="alert">
          <Icon name="error" /> Fill in the required fields.
        </p>
      )}
    </div>
  )
}

function Row({
  label,
  required,
  invalid,
  children,
}: {
  label: string
  required?: boolean
  invalid?: boolean
  children: ReactNode
}) {
  return (
    <div className={`cf-row ${invalid ? 'invalid' : ''}`}>
      <span className="cf-label">
        {label}
        {required && <span className="cf-required"> *</span>}
      </span>
      <div className="cf-control">{children}</div>
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: 'shield' | 'gear'
  title: string
  children: ReactNode
}) {
  return (
    <section className="cf-form-section">
      <h2>
        <Icon name={icon} /> {title}
      </h2>
      {children}
    </section>
  )
}

function FieldRow({
  field,
  value,
  invalid,
  suggestions,
  onRefresh,
  onChange,
  after,
}: {
  field: OptionField
  value: string | boolean | undefined
  invalid: boolean
  suggestions?: string[] | undefined
  onRefresh?: (() => Promise<void>) | undefined
  onChange: (value: string | boolean) => void
  after?: ReactNode
}) {
  const listId = suggestions?.length ? `cf-list-${field.key}` : undefined
  let control: ReactNode
  switch (field.kind) {
    case 'boolean':
      control = <Toggle checked={value === true} label={field.label} onChange={onChange} />
      break
    case 'enum':
      control =
        field.values.length <= 4 ? (
          <Segmented
            value={String(value ?? field.default ?? field.values[0])}
            options={field.values.map((item) => ({ value: item, label: item }))}
            onChange={onChange}
          />
        ) : (
          <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
            {field.values.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        )
      break
    default:
      control = (
        <div className="cf-input-with-button">
          <input
            value={String(value ?? '')}
            placeholder={
              field.placeholder ?? (field.default === undefined ? '' : String(field.default))
            }
            aria-label={field.label}
            inputMode={field.kind === 'number' ? 'numeric' : undefined}
            spellCheck={false}
            list={listId}
            onChange={(event) =>
              onChange(
                field.kind === 'number'
                  ? event.target.value.replace(/\D/g, '')
                  : event.target.value,
              )
            }
          />
          {listId && (
            <datalist id={listId}>
              {suggestions!.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          )}
          {onRefresh && (
            <button
              className="cf-icon-button inset"
              title="Connect and list databases"
              aria-label="List databases"
              onClick={() => void onRefresh()}
            >
              <Icon name="refresh" />
            </button>
          )}
        </div>
      )
  }
  return (
    <>
      <Row label={field.label} required={field.required} invalid={invalid}>
        {control}
        {field.description && <p className="cf-description">{field.description}</p>}
      </Row>
      {after}
    </>
  )
}

function SecretRow({
  label,
  value,
  saved,
  onChange,
}: {
  label: string
  value: string
  saved: boolean
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <Row label={label}>
      <div className="cf-input-with-button">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={saved ? 'Saved — leave empty to keep' : label}
          aria-label={label}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="cf-icon-button inset"
          title={visible ? 'Hide' : 'Show'}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setVisible(!visible)}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      <p className="cf-description">
        <Icon name="lock" size={12} /> Kept in VS Code secret storage on this machine, never in
        settings.
      </p>
    </Row>
  )
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string; danger?: boolean }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="cf-segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          className={`${option.value === value ? 'selected' : ''} ${option.danger ? 'danger' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`cf-toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function TestStatus({ state }: { state: TestState }) {
  if (state.status !== 'done') return null
  const { result } = state
  if (!result.ok) {
    return (
      <span className="cf-test error" title={result.message}>
        <Icon name="error" /> {result.message}
      </span>
    )
  }
  const count = result.databases.length
  return (
    <span className="cf-test ok">
      <Icon name="check" /> Connected in {result.durationMs} ms
      {count ? ` · ${count} database${count === 1 ? '' : 's'}` : ''}
    </span>
  )
}

/** Option values as the inputs show them; `withDefaults` fills empty fields from the driver. */
function toValues(
  fields: readonly OptionField[],
  options: Record<string, unknown>,
  withDefaults = true,
): Values {
  const values: Values = {}
  for (const field of fields) {
    const raw = options[field.key]
    if (raw === undefined && !withDefaults) continue
    if (field.kind === 'boolean')
      values[field.key] = raw === true || (raw === undefined && field.default === true)
    else if (typeof raw === 'string' || typeof raw === 'number') values[field.key] = String(raw)
    else values[field.key] = ''
  }
  return values
}

function fromValues(fields: readonly OptionField[], values: Values): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.key]
    if (value === undefined) continue
    options[field.key] = field.kind === 'number' && value !== '' ? Number(value) : value
  }
  return options
}

/** Placeholder name, used when the user leaves the name empty: `shop @ db.internal`. */
function suggestName(entry: CatalogEntry, driver: DriverDescriptor, values: Values): string {
  const database = typeof values.database === 'string' ? values.database : ''
  const host = typeof values.host === 'string' ? values.host : ''
  const where = [database, host].filter(Boolean).join(' @ ')
  if (entry.id !== driver.kind) return where ? `${entry.label} · ${database || host}` : entry.label
  return where || driver.displayName
}

/** The form was filled in by an AI agent: nothing is saved until the user saves it. */
function AgentNotice({
  proposal,
  editing,
}: {
  proposal: NonNullable<FormStart['proposal']>
  editing: boolean
}) {
  const warned = proposal.warnings.length > 0
  return (
    <div className={`cf-agent ${warned ? 'danger' : ''}`} role="status">
      <Icon name={warned ? 'error' : 'shield'} />
      <div>
        <strong>Filled in by an AI agent.</strong> Check every field before saving; nothing is saved
        until you do.
        {editing && (
          <div className="cf-agent-changes">
            {proposal.changed.length
              ? `Changed: ${proposal.changed.join(', ')}.`
              : 'No changes to the saved connection.'}
          </div>
        )}
        {proposal.warnings.map((warning) => (
          <div key={warning} className="cf-agent-warning">
            {warning}
          </div>
        ))}
      </div>
    </div>
  )
}
