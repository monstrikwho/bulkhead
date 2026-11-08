import { PANEL, type PanelAsk, type PanelConnection, type PanelReply } from '@bulkhead/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Icon, type IconName } from '../icons'
import { orcaFrame } from './bridge'

/** Unlock and secret prompts wait for the user, so requests may take up to Orca's maximum. */
export async function call<T = unknown>(name: string, input?: unknown): Promise<T> {
  const reply = (await orcaFrame().plugin.request(name, input ?? null, {
    timeoutMs: 120_000,
  })) as PanelReply<T>
  if (!reply.ok) throw new Error(reply.message)
  return reply.value
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** An icon button; `label` is its tooltip and its accessible name. */
export function IconButton({
  icon,
  label,
  onClick,
  className = '',
}: {
  icon: IconName
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={`oa-icon ${className}`}
      data-tip={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}

export function AccessBadge({ connection }: { connection: PanelConnection }) {
  const readOnly = connection.accessMode === 'read-only'
  if (connection.production) {
    return (
      <span
        className={`badge ${readOnly ? '' : 'danger'} oa-prod`}
        data-tip={
          readOnly
            ? 'Production: read-only. Writes need “Unlock writes…” and the typed name.'
            : 'Production with writes unlocked until you lock them or disconnect.'
        }
      >
        {readOnly ? 'PROD · read-only' : 'PROD · WRITES UNLOCKED'}
      </span>
    )
  }
  return readOnly ? <span className="badge">read-only</span> : null
}

/**
 * Tooltips for everything with `data-tip`. Orca's isolated frames do not show native `title`
 * tooltips, so the frame draws its own: after a short hover or on keyboard focus, kept inside
 * the frame so a button at the edge of a narrow sidebar still shows its whole text.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; anchor: DOMRect }>()
  const box = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const target = (event: Event) =>
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null
    const show = (element: HTMLElement, delay: number) => {
      clearTimeout(timer)
      timer = setTimeout(
        () => setTip({ text: element.dataset.tip ?? '', anchor: element.getBoundingClientRect() }),
        delay,
      )
    }
    const hide = () => {
      clearTimeout(timer)
      setTip(undefined)
    }
    const over = (event: Event) => {
      const element = target(event)
      if (element) show(element, 400)
      else hide()
    }
    const focus = (event: Event) => {
      const element = target(event)
      if (element?.matches(':focus-visible')) show(element, 0)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('keydown', hide)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerover', over)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('keydown', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  useLayoutEffect(() => {
    const element = box.current
    if (!tip || !element) {
      setPosition(undefined)
      return
    }
    const { width, height } = element.getBoundingClientRect()
    const margin = 4
    const below = tip.anchor.bottom + margin
    const top =
      below + height <= window.innerHeight
        ? below
        : Math.max(margin, tip.anchor.top - height - margin)
    const centred = tip.anchor.left + tip.anchor.width / 2 - width / 2
    const left = Math.min(Math.max(margin, centred), window.innerWidth - width - margin)
    setPosition({ left, top })
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={box}
      className="oa-tooltip"
      role="tooltip"
      style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
    >
      {tip.text}
    </div>
  )
}

/**
 * A secret to type, or the unlock confirmation, in whichever Bulkhead frame is on screen. The
 * worker asks every frame; the first answer counts and `PANEL.asked` closes it in the others.
 * The worker decides what an answer means.
 */
export function Questions() {
  const [ask, setAsk] = useState<PanelAsk>()
  useEffect(() => {
    const frame = orcaFrame()
    const subscriptions = [
      frame.plugin.on(PANEL.ask, (payload) => setAsk(payload as PanelAsk)),
      frame.plugin.on(PANEL.asked, (payload) => {
        const { id } = payload as { id: string }
        setAsk((current) => (current?.id === id ? undefined : current))
      }),
    ]
    return () => subscriptions.forEach((subscription) => subscription.dispose())
  }, [])
  return ask ? <AskDialog key={ask.id} ask={ask} onDone={() => setAsk(undefined)} /> : null
}

function AskDialog({ ask, onDone }: { ask: PanelAsk; onDone: () => void }) {
  const [value, setValue] = useState('')
  const answer = (reply: string | null) => {
    onDone()
    void call(PANEL.prompt, { id: ask.id, value: reply }).catch(() => undefined)
  }
  const typedName = ask.kind === 'unlock' && ask.production
  const canConfirm = ask.kind === 'secret' || !typedName || value === ask.name
  return (
    <div className="oa-overlay" role="dialog" aria-modal="true">
      <form
        className={`oa-dialog ${ask.kind === 'unlock' && ask.production ? 'production' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          if (!canConfirm) return
          answer(ask.kind === 'unlock' && !typedName ? 'yes' : value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') answer(null)
        }}
      >
        {ask.kind === 'secret' ? (
          <>
            <h2>{ask.title}</h2>
            <input
              autoFocus
              type="password"
              autoComplete="off"
              aria-label={ask.label}
              placeholder={ask.label}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <p className="muted">Kept in Orca secret storage on this machine.</p>
          </>
        ) : typedName ? (
          <>
            <h2 className="error">Unlock writes on PRODUCTION</h2>
            <p>
              Writes stay unlocked until you disconnect or lock them again. Type “{ask.name}” to
              confirm.
            </p>
            <input
              autoFocus
              aria-label="Connection name"
              value={value}
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
            />
          </>
        ) : (
          <>
            <h2>Unlock writes</h2>
            <p>Allow writes on “{ask.name}” until you disconnect?</p>
          </>
        )}
        <div className="oa-dialog-buttons">
          <button type="button" className="secondary" onClick={() => answer(null)}>
            Cancel
          </button>
          <button
            type="submit"
            className={ask.kind === 'unlock' ? 'danger' : ''}
            disabled={!canConfirm}
          >
            {ask.kind === 'unlock' ? 'Unlock' : 'OK'}
          </button>
        </div>
      </form>
    </div>
  )
}
