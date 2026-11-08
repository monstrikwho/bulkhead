/**
 * The part of Orca's worker API (`activate(orca)`, Host API 1.4) this plugin uses. Written out
 * here instead of importing the types `orca plugin types` generates: those live in a gitignored
 * `.orca/` folder and CI has no Orca to generate them. Names and shapes follow `orca/worker`.
 */

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface OrcaDisposable {
  dispose(): void
}

export interface PanelRequestContext {
  panel: { id: string; surface: 'panel' | 'editor'; contributionId: string }
  signal: AbortSignal
}

export interface OrcaStorage {
  get(key: string): Promise<JsonValue | null>
  set(key: string, value: JsonValue): Promise<void>
  delete(key: string): Promise<void>
  onDidChange(listener: (change: { key: string }) => void): OrcaDisposable
}

export interface OrcaSecrets {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface OrcaWorker {
  readonly commands: {
    register(id: string, handler: (args: unknown) => unknown): OrcaDisposable
  }
  readonly host: { call(method: string, params?: JsonValue): Promise<unknown> }
  readonly panels: {
    handle(
      name: string,
      handler: (input: JsonValue | undefined, context: PanelRequestContext) => unknown,
    ): OrcaDisposable
    /** At most 256 KiB, 200 per 10 s. */
    post(event: string, payload?: JsonValue, options?: { panel?: string }): void
  }
  readonly storage: OrcaStorage
  readonly secrets: OrcaSecrets
  log(message: string): void
}
