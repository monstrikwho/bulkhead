import { describe, expect, it } from 'vitest'

import { preview } from './explorer'

const table = '"shop"."customers"'

describe('preview', () => {
  it('selects * when every column is readable, a table without columns too', () => {
    expect(preview({ readable: ['id', 'email'], columns: 2 }, table)).toEqual({
      previewQuery: 'SELECT * FROM "shop"."customers"',
    })
    expect(preview({ readable: [], columns: 0 }, table)).toEqual({
      previewQuery: 'SELECT * FROM "shop"."customers"',
    })
  })

  it('lists the readable columns, quoted, and counts the hidden ones', () => {
    expect(preview({ readable: ['id', 'Odd "name"'], columns: 5 }, table)).toEqual({
      previewQuery: 'SELECT "id", "Odd ""name""" FROM "shop"."customers"',
      previewNotice: '3 columns hidden: no SELECT privilege.',
    })
    expect(preview({ readable: ['id'], columns: 2 }, table).previewNotice).toBe(
      '1 column hidden: no SELECT privilege.',
    )
  })

  it('has no query when nothing is readable', () => {
    expect(preview({ readable: [], columns: 3 }, table)).toEqual({
      previewNotice:
        'No readable columns: your role has no SELECT privilege on any column of "shop"."customers".',
    })
  })
})
