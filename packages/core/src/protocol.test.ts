import { describe, expect, it } from 'vitest'

import { isWebviewToHost } from './protocol'

describe('isWebviewToHost', () => {
  it('accepts the known welcome actions only', () => {
    expect(isWebviewToHost({ type: 'action', action: 'new-connection' })).toBe(true)
    expect(isWebviewToHost({ type: 'action', action: 'workbench.action.terminal.new' })).toBe(false)
    expect(isWebviewToHost({ type: 'action' })).toBe(false)
  })

  it('accepts refresh and rejects unknown messages', () => {
    expect(isWebviewToHost({ type: 'refresh' })).toBe(true)
    expect(isWebviewToHost({ type: 'run', script: 'drop table users' })).toBe(false)
    expect(isWebviewToHost(null)).toBe(false)
  })
})
