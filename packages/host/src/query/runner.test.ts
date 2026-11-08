import type { CancelSignal, ConnectionProfile, DriverSession, HostToWebview } from '@bulkhead/core'
import { describe, expect, it } from 'vitest'

import type { ConnectionManager } from '../connections/manager'
import { CancellationError, type ResultsTarget } from '../ports'
import { format, RecordingUi } from '../testing'
import { pickStatement, QueryRunner } from './runner'

const profile: ConnectionProfile = {
  id: 'p',
  name: 'shop',
  driver: 'postgres',
  production: false,
  transport: { kind: 'direct' },
  options: {},
}

class Target implements ResultsTarget {
  readonly posted: HostToWebview[] = []
  reveal(): void {}
  post(message: HostToWebview): void {
    this.posted.push(message)
  }
}

/** A manager whose session runs `execute`, or whose connect fails with `connectError`. */
function setup(execute: DriverSession['execute'], connectError?: Error) {
  const session = { accessMode: 'read-only', execute } as unknown as DriverSession
  const manager = {
    session: () => (connectError ? Promise.reject(connectError) : Promise.resolve(session)),
  } as unknown as ConnectionManager
  const results = new Target()
  const ui = new RecordingUi()
  const runner = new QueryRunner(manager, { results, maxRows: () => 7, ui, t: format })
  return { runner, results, ui }
}

describe('QueryRunner', () => {
  it('reports a run to the default target with the configured row limit', async () => {
    let maxRows: number | undefined
    const { runner, results } = setup((_, options) => {
      maxRows = options.maxRows
      return Promise.resolve([])
    })
    await runner.run(profile, 'select 1', 'shop')
    expect(maxRows).toBe(7)
    expect(results.posted.map((message) => message.type)).toEqual(['run-started', 'run-finished'])
    expect(results.posted[0]).toMatchObject({
      connection: { name: 'shop', database: 'shop', accessMode: 'read-only' },
      script: 'select 1',
    })
  })

  it('refuses a second run on a busy target and cancels the running one', async () => {
    let signal: CancelSignal | undefined
    const { runner, results, ui } = setup((_, options) => {
      signal = options.signal
      return new Promise((resolve) => options.signal?.addEventListener('abort', () => resolve([])))
    })
    const first = runner.run(profile, 'select pg_sleep(10)')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await runner.run(profile, 'select 2')
    expect(ui.shown).toEqual([
      { level: 'warning', message: 'A query is already running. Cancel it first.' },
    ])
    runner.cancel()
    await first
    expect(signal?.aborted).toBe(true)
    expect(results.posted.filter((message) => message.type === 'run-started')).toHaveLength(1)
  })

  it('shows a failure in the target and as an error, and stays silent on a dismissed prompt', async () => {
    const failing = setup(() => Promise.reject(new Error('relation "x" does not exist')))
    await failing.runner.run(profile, 'select * from x')
    expect(failing.results.posted.at(-1)).toMatchObject({
      type: 'run-failed',
      message: 'relation "x" does not exist',
    })
    expect(failing.ui.shown).toEqual([
      { level: 'error', message: 'shop: relation "x" does not exist' },
    ])

    const dismissed = setup(() => Promise.resolve([]), new CancellationError())
    await dismissed.runner.run(profile, 'select 1')
    expect(dismissed.results.posted).toEqual([])
    expect(dismissed.ui.shown).toEqual([])
  })
})

describe('pickStatement', () => {
  const text = 'select 1;\nselect 2;\n'

  it('picks the statement under the cursor with its offsets', () => {
    const picked = pickStatement(text, text.indexOf('2'), 'postgres')
    expect(picked.text).toBe('select 2')
    expect(picked.range && text.slice(picked.range.start, picked.range.end)).toBe('select 2')
  })
})
