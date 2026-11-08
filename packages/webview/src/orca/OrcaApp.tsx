import {
  PANEL,
  type ConnectionAction,
  type ExplorerNode,
  type PanelConnection,
  type PanelState,
  type PanelView,
} from '@bulkhead/core'
import { useCallback, useEffect, useState } from 'react'

import { ConnectionFormApp } from '../connectionForm/ConnectionFormApp'
import { Icon } from '../icons'
import { Welcome } from '../Welcome'
import { orcaFrame } from './bridge'
import { AccessBadge, call, IconButton, messageOf, Questions, Tooltips } from './shared'

/**
 * The Bulkhead sidebar in Orca: the connection tree, full height. SQL consoles and table data
 * open as editor tabs (`ConsoleApp`, `TableApp`); the connection form takes the sidebar while
 * it is open. Every decision (what is read-only, whether a typed name unlocks writes) is the
 * worker's; this only draws.
 */
export function OrcaApp() {
  const [state, setState] = useState<PanelState>()
  const [view, setView] = useState<PanelView>('main')
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<string>()

  const refresh = useCallback(
    () =>
      call<PanelState>(PANEL.state).then(
        (next) => {
          setState(next)
          setView(next.view)
        },
        (failure: unknown) => setError(messageOf(failure)),
      ),
    [],
  )

  useEffect(() => {
    const frame = orcaFrame()
    const subscriptions = [
      frame.plugin.on(PANEL.changed, () => void refresh()),
      frame.plugin.on(PANEL.view, (payload) => setView((payload as { view: PanelView }).view)),
    ]
    void refresh()
    return () => subscriptions.forEach((subscription) => subscription.dispose())
  }, [refresh])

  const request = (name: string, input?: unknown) => {
    setError(undefined)
    return call(name, input).catch((failure: unknown) => setError(messageOf(failure)))
  }
  const act = async (connectionId: string, action: ConnectionAction) => {
    await request(PANEL.connection, { connectionId, action })
    void refresh()
  }

  if (view === 'form') {
    return (
      <div className="oa-form">
        <ConnectionFormApp />
        <Questions />
        <Tooltips />
      </div>
    )
  }

  const empty = state && state.connections.length === 0 && state.invalid.length === 0
  return (
    <div className="oa-root">
      <header className="oa-bar">
        <strong>Connections</strong>
        <span className="spacer" />
        <IconButton
          icon="plus"
          label="New connection"
          onClick={() => void request(PANEL.newConnection)}
        />
        <IconButton icon="refresh" label="Refresh connections" onClick={() => void refresh()} />
      </header>

      {error && (
        <p className="oa-error" role="alert">
          <Icon name="error" size={12} />
          <span className="oa-error-text" data-tip={error}>
            {error}
          </span>
          <IconButton icon="close" label="Dismiss" onClick={() => setError(undefined)} />
        </p>
      )}

      {!state && <p className="muted oa-pad">Loading…</p>}
      {empty ? (
        <section className="oa-welcome">
          <Welcome />
        </section>
      ) : (
        <ul className="oa-tree" role="tree" aria-label="Connections">
          {state?.connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              selected={selected === connection.id}
              onSelect={() => setSelected(connection.id)}
              onAction={(action) => void act(connection.id, action)}
              onConsole={() => void request(PANEL.openConsole, { connectionId: connection.id })}
              onOpen={(node) =>
                void request(PANEL.openTable, { connectionId: connection.id, node })
              }
              onError={setError}
            />
          ))}
          {state?.invalid.map((entry) => (
            <li key={entry.name} className="oa-row invalid" data-tip={entry.message}>
              <Icon name="error" /> {entry.name}: {entry.message}
            </li>
          ))}
        </ul>
      )}

      {state && (
        <p className="oa-agents muted" data-tip={state.agents.detail}>
          <Icon name="sparkle" size={12} /> MCP for AI agents: {state.agents.running ? 'on' : 'off'}
        </p>
      )}
      <Questions />
      <Tooltips />
    </div>
  )
}

function ConnectionRow({
  connection,
  selected,
  onSelect,
  onAction,
  onConsole,
  onOpen,
  onError,
}: {
  connection: PanelConnection
  selected: boolean
  onSelect: () => void
  onAction: (action: ConnectionAction) => void
  onConsole: () => void
  onOpen: (node: ExplorerNode) => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const readOnly = connection.accessMode === 'read-only'
  return (
    <li
      className={`oa-connection ${connection.production ? 'production' : ''}`}
      role="treeitem"
      aria-expanded={open}
      aria-selected={selected}
    >
      <div className={`oa-row ${selected ? 'selected' : ''}`}>
        <button
          className="oa-twisty"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => {
            setOpen(!open)
            onSelect()
          }}
        >
          <Icon name="chevron" className={open ? 'open' : ''} />
        </button>
        <button
          className="oa-label"
          data-tip={`${connection.target}${connection.connected ? ' · connected' : ''}`}
          onClick={onSelect}
          onDoubleClick={onConsole}
        >
          <span className={`oa-dot ${connection.connected ? 'on' : ''}`} />
          <span className="oa-name">{connection.name}</span>
          <AccessBadge connection={connection} />
          <span className="muted oa-desc">{connection.target}</span>
        </button>
        <span className="oa-actions">
          <IconButton icon="terminal" label="Open SQL console" onClick={onConsole} />
          {connection.connected ? (
            <IconButton icon="plug" label="Disconnect" onClick={() => onAction('disconnect')} />
          ) : (
            <IconButton icon="plug" label="Connect" onClick={() => onAction('connect')} />
          )}
          {readOnly ? (
            <IconButton
              icon="lock"
              label={
                connection.production
                  ? 'Unlock writes… (type the connection name to confirm)'
                  : 'Unlock writes…'
              }
              onClick={() => onAction('unlock')}
            />
          ) : (
            <IconButton
              icon="shield"
              label="Lock writes (back to read-only)"
              onClick={() => onAction('lock')}
            />
          )}
          <IconButton icon="edit" label="Edit connection" onClick={() => onAction('edit')} />
          <IconButton
            icon="trash"
            label="Remove connection…"
            onClick={() => setConfirmRemove(true)}
          />
        </span>
      </div>
      {confirmRemove && (
        <div className="oa-confirm" role="alert">
          Remove “{connection.name}” and its saved password?
          <button
            type="button"
            className="danger"
            onClick={() => {
              setConfirmRemove(false)
              onAction('remove')
            }}
          >
            Remove
          </button>
          <button type="button" className="secondary" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
        </div>
      )}
      {open && (
        <Children connectionId={connection.id} depth={1} onOpen={onOpen} onError={onError} />
      )}
    </li>
  )
}

function Children({
  connectionId,
  node,
  depth,
  onOpen,
  onError,
}: {
  connectionId: string
  node?: ExplorerNode
  depth: number
  onOpen: (node: ExplorerNode) => void
  onError: (message: string) => void
}) {
  const [children, setChildren] = useState<ExplorerNode[]>()
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    call<ExplorerNode[]>(PANEL.children, { connectionId, ...(node ? { node } : {}) }).then(
      setChildren,
      (failure: unknown) => {
        setFailed(messageOf(failure))
        onError(messageOf(failure))
      },
    )
    // Children load once per expansion; collapsing and expanding again reloads them.
  }, [connectionId, node, onError])

  if (failed) return null
  if (!children) {
    return (
      <p className="muted oa-node" style={{ paddingLeft: depth * 8 + 18 }}>
        Loading…
      </p>
    )
  }
  return (
    <ul role="group">
      {children.map((child) => (
        <NodeRow
          key={child.id}
          connectionId={connectionId}
          node={child}
          depth={depth}
          onOpen={onOpen}
          onError={onError}
        />
      ))}
    </ul>
  )
}

function NodeRow({
  connectionId,
  node,
  depth,
  onOpen,
  onError,
}: {
  connectionId: string
  node: ExplorerNode
  depth: number
  onOpen: (node: ExplorerNode) => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const openable = Boolean(node.previewQuery || node.previewNotice)
  return (
    <li role="treeitem" aria-expanded={node.expandable ? open : undefined}>
      <div className="oa-row oa-node" style={{ paddingLeft: depth * 8 }}>
        {node.expandable ? (
          <button
            className="oa-twisty"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen(!open)}
          >
            <Icon name="chevron" className={open ? 'open' : ''} />
          </button>
        ) : (
          <span className="oa-twisty" />
        )}
        <button
          className="oa-label"
          data-tip={
            [node.tooltip ?? node.qualifiedName, openable ? 'Double-click to open its data' : '']
              .filter(Boolean)
              .join(' · ') || undefined
          }
          onClick={() => node.expandable && setOpen(!open)}
          onDoubleClick={() => openable && onOpen(node)}
        >
          <span className="oa-name">{node.label}</span>
          {node.description && <span className="muted oa-desc">{node.description}</span>}
        </button>
        {openable && (
          <span className="oa-actions">
            <IconButton icon="table" label="Open data in a tab" onClick={() => onOpen(node)} />
          </span>
        )}
      </div>
      {open && (
        <Children
          connectionId={connectionId}
          node={node}
          depth={depth + 1}
          onOpen={onOpen}
          onError={onError}
        />
      )}
    </li>
  )
}
