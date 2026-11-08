import { randomUUID } from 'node:crypto'

import {
  PANEL,
  type HostToWebview,
  type PanelAsk,
  type PanelView,
  type PromptAnswer,
  type RunRequest,
  type WebviewPush,
} from '@bulkhead/core'
import type { ResultsTarget } from '@bulkhead/host'

import { toJson } from './json'
import type { JsonValue, OrcaWorker } from './orcaApi'

/** A question for the frames; the id is added here. */
export type PanelQuestion = PanelAsk extends infer Ask
  ? Ask extends PanelAsk
    ? Omit<Ask, 'id'>
    : never
  : never

/** Orca drops worker pushes over 256 KiB; stay clear of it, the envelope adds a little. */
export const PUSH_LIMIT = 200 * 1024
/**
 * Characters per page of a large message. A reply may be 1 MiB of JSON; a character takes at
 * most 6 bytes there (`\u0000`), so 128 Ki characters always fit.
 */
export const PAGE_CHARS = 128 * 1024
/** Unfetched large messages are dropped after this long. */
const LARGE_TTL_MS = 5 * 60_000
/** Orca gives a panel request at most 120 s; a prompt must answer before that. */
const ASK_TIMEOUT_MS = 110_000

/**
 * The results of one editor tab (a console or a table): its own runs, pushed to that frame
 * alone, and replayed when the frame mounts again (Orca reloads a tab's frame on re-show).
 */
export class FrameResults implements ResultsTarget {
  private lastRun: HostToWebview[] = []
  /** What the tab ran last, for a table's refresh button. */
  lastRequest: RunRequest | undefined

  constructor(
    private readonly host: PanelHost,
    readonly frameId: string,
  ) {}

  // Orca cannot bring a tab to front from the worker; the tab that asked is on screen.
  reveal(): void {}

  post(message: HostToWebview): void {
    if (message.type === 'run-started') this.lastRun = [message]
    else this.lastRun.push(message)
    this.host.pushWebview(message, this.frameId)
  }

  replay(): void {
    for (const message of this.lastRun) this.host.pushWebview(message, this.frameId)
  }
}

/**
 * Everything the worker sends to Bulkhead's frames (the sidebar panel and the editor tabs):
 * webview messages (paged when large), the sidebar's view, change notices and questions.
 */
export class PanelHost {
  private readonly large = new Map<string, { pages: string[]; timer: NodeJS.Timeout }>()
  private readonly asks = new Map<string, (value: string | null) => void>()
  private readonly frames = new Map<string, FrameResults>()
  private currentView: PanelView = 'main'

  constructor(private readonly orca: Pick<OrcaWorker, 'panels' | 'log'>) {}

  get view(): PanelView {
    return this.currentView
  }

  setView(view: PanelView): void {
    this.currentView = view
    this.orca.panels.post(PANEL.view, { view })
  }

  /** Something in the panel's state changed; it asks for the new state. */
  changed(): void {
    this.orca.panels.post(PANEL.changed, null)
  }

  /** The results of the editor tab with this frame id. */
  results(frameId: string): FrameResults {
    let frame = this.frames.get(frameId)
    if (!frame) {
      frame = new FrameResults(this, frameId)
      this.frames.set(frameId, frame)
    }
    return frame
  }

  /** A results app mounted (again): show it its last run, if it had one. */
  replay(frameId: string): void {
    this.frames.get(frameId)?.replay()
  }

  /**
   * Pushes a results or form message to one frame, or to all (the form, which only the sidebar
   * shows); a large one as a reference to fetch in pages.
   */
  pushWebview(message: unknown, frameId?: string): void {
    const options = frameId === undefined ? undefined : { panel: frameId }
    const text = JSON.stringify(message)
    if (Buffer.byteLength(text) <= PUSH_LIMIT) {
      this.orca.panels.post(PANEL.webview, { message: JSON.parse(text) as JsonValue }, options)
      return
    }
    const id = randomUUID()
    const pages: string[] = []
    for (let start = 0; start < text.length; start += PAGE_CHARS) {
      pages.push(text.slice(start, start + PAGE_CHARS))
    }
    const timer = setTimeout(() => this.large.delete(id), LARGE_TTL_MS)
    timer.unref()
    this.large.set(id, { pages, timer })
    const push: WebviewPush = { large: { id, pages: pages.length } }
    this.orca.panels.post(PANEL.webview, toJson(push), options)
  }

  /** One page of a large message; the last page also frees it. */
  page(id: string, index: number): string {
    const entry = this.large.get(id)
    const page = entry?.pages[index]
    if (!entry || page === undefined) throw new Error('That result is no longer available.')
    if (index === entry.pages.length - 1) {
      clearTimeout(entry.timer)
      this.large.delete(id)
    }
    return page
  }

  /**
   * Asks the user in every open frame; the first answer counts and the others close the
   * question. `null` when they dismiss it, or when no frame answers in time: a question nobody
   * saw is a no.
   */
  ask(question: PanelQuestion): Promise<string | null> {
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(null), ASK_TIMEOUT_MS)
      const settle = (value: string | null) => {
        clearTimeout(timer)
        this.asks.delete(id)
        this.orca.panels.post(PANEL.asked, { id })
        resolve(value)
      }
      this.asks.set(id, settle)
      this.orca.panels.post(PANEL.ask, toJson({ ...question, id }))
    })
  }

  answer({ id, value }: PromptAnswer): void {
    this.asks.get(id)?.(value)
  }

  dispose(): void {
    for (const { timer } of this.large.values()) clearTimeout(timer)
    this.large.clear()
    for (const settle of [...this.asks.values()]) settle(null)
    this.frames.clear()
  }
}
