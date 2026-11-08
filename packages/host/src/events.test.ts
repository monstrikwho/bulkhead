import { describe, expect, it } from 'vitest'

import { Emitter } from './events'

describe('Emitter', () => {
  it('delivers to every listener until it unsubscribes', () => {
    const emitter = new Emitter<string>()
    const seen: string[] = []
    const first = emitter.event((value) => seen.push(`a:${value}`))
    emitter.event((value) => seen.push(`b:${value}`))
    emitter.fire('1')
    first.dispose()
    emitter.fire('2')
    expect(seen).toEqual(['a:1', 'b:1', 'b:2'])
  })

  it('keeps a failing listener from failing the caller or the other listeners', () => {
    const emitter = new Emitter<void>()
    let calls = 0
    emitter.event(() => {
      throw new Error('listener bug')
    })
    emitter.event(() => calls++)
    expect(() => emitter.fire()).not.toThrow()
    expect(calls).toBe(1)
  })

  it('forgets its listeners when disposed', () => {
    const emitter = new Emitter<void>()
    let calls = 0
    emitter.event(() => calls++)
    emitter.dispose()
    emitter.fire()
    expect(calls).toBe(0)
  })
})
