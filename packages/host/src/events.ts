/** Structurally compatible with `vscode.Disposable`, so hosts can push these into their lists. */
export interface Disposable {
  dispose(): void
}

/** Subscribes a listener; dispose the result to unsubscribe. A subset of `vscode.Event`. */
export type Event<T> = (listener: (value: T) => void) => Disposable

/** The minimal event emitter the host-agnostic code needs, since `vscode.EventEmitter` is out. */
export class Emitter<T> implements Disposable {
  private readonly listeners = new Set<(value: T) => void>()

  readonly event: Event<T> = (listener) => {
    // Wrapped, so the same function subscribed twice gets two independent subscriptions.
    const entry = (value: T) => listener(value)
    this.listeners.add(entry)
    return { dispose: () => this.listeners.delete(entry) }
  }

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value)
      } catch {
        // Like `vscode.EventEmitter`: a failing listener must not fail the code that fired, e.g.
        // a session that has just opened.
      }
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}
