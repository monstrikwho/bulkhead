import { describe, expect, it } from 'vitest'

import { splitStatements, statementAt } from './splitter'

const texts = (sql: string, dialect?: 'postgres' | 'clickhouse') =>
  splitStatements(sql, dialect).map((s) => s.text)

describe('splitStatements', () => {
  it('splits on top-level semicolons and trims', () => {
    expect(texts('select 1;\n  select 2 ;\n\n')).toEqual(['select 1', 'select 2'])
  })

  it('keeps the last statement without a semicolon', () => {
    expect(texts('select 1; select 2')).toEqual(['select 1', 'select 2'])
  })

  it('ignores semicolons in strings, identifiers and comments', () => {
    const sql = `select 'a;b', "c;d" -- e;f
      /* g; /* nested; */ h; */ from t; select 2`
    expect(texts(sql)).toHaveLength(2)
  })

  it('handles doubled quotes and E-strings with backslash escapes', () => {
    expect(texts(`select 'it''s;'; select E'\\';'; select 3`)).toEqual([
      `select 'it''s;'`,
      `select E'\\';'`,
      'select 3',
    ])
  })

  it('keeps dollar-quoted bodies whole, including tagged ones', () => {
    const sql = `create function f() returns int as $body$ begin return 1; end; $body$ language plpgsql;
      do $$ begin perform 1; end $$; select $1`
    expect(texts(sql)).toEqual([
      'create function f() returns int as $body$ begin return 1; end; $body$ language plpgsql',
      'do $$ begin perform 1; end $$',
      'select $1',
    ])
  })

  it('keeps BEGIN ATOMIC bodies whole, including CASE … END inside', () => {
    const sql = `create function f(x int) returns int begin atomic
      select case when x > 0 then 1 else 0 end; select 2;
    end; select 3`
    expect(texts(sql)).toHaveLength(2)
    expect(texts(sql)[1]).toBe('select 3')
  })

  it('drops comment-only statements', () => {
    expect(texts('-- nothing\n; /* still nothing */ ; select 1')).toEqual(['select 1'])
  })

  it('treats backslash escapes and backticks as ClickHouse quoting', () => {
    expect(texts("select 'a\\';b', `x;y` from t; select 2", 'clickhouse')).toHaveLength(2)
  })

  it('reports offsets that slice back to the statement', () => {
    const sql = '  select 1 ;\nselect 2'
    for (const statement of splitStatements(sql)) {
      expect(sql.slice(statement.start, statement.end)).toBe(statement.text)
    }
  })
})

describe('statementAt', () => {
  const sql = 'select 1;\nselect 2;\nselect 3'
  const statements = splitStatements(sql)

  it('finds the statement under the cursor', () => {
    expect(statementAt(statements, sql.indexOf('2'))?.text).toBe('select 2')
  })

  it('falls back to the statement before the cursor', () => {
    expect(statementAt(statements, sql.indexOf(';\nselect 3') + 1)?.text).toBe('select 2')
  })

  it('falls back to the first statement before any text', () => {
    expect(statementAt(splitStatements('\n\nselect 1'), 0)?.text).toBe('select 1')
  })
})
