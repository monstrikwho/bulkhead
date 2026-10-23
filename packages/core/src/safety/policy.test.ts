import { describe, expect, it } from 'vitest'

import { classifyStatement } from './classify'
import { checkReadOnly, initialAccessMode } from './policy'

describe('classifyStatement', () => {
  it.each([
    'select * from users',
    '  -- comment\n SELECT 1',
    'with t as (select 1) select * from t',
    'values (1), (2)',
    'table users',
    'show search_path',
    'explain select * from users',
    'explain (analyze, buffers) select * from users',
    '(select 1) union (select 2)',
    "select 'delete from users'",
    'select "update" from t',
  ])('reads: %s', (sql) => {
    expect(classifyStatement(sql).category).toBe('read')
  })

  it.each([
    ['insert into t values (1)', 'INSERT'],
    ['update t set a = 1', 'UPDATE'],
    ['delete from t', 'DELETE'],
    ['truncate t', 'TRUNCATE'],
    ['create table t (a int)', 'CREATE'],
    ['drop table t', 'DROP'],
    ['do $$ begin delete from t; end $$', 'DO'],
    ['call p()', 'CALL'],
    ['copy t from stdin', 'COPY'],
    ['vacuum t', 'VACUUM'],
    ['grant select on t to x', 'GRANT'],
    ['lock table t', 'LOCK'],
    ['with d as (delete from t returning *) select * from d', 'WITH'],
    ['select * into backup from t', 'SELECT'],
    ['(select * into backup from t)', 'SELECT'],
    ['select * from t for update', 'SELECT'],
    ['select * from t for no key update', 'SELECT'],
    ['select * from t for share', 'SELECT'],
    ['explain analyze delete from t', 'EXPLAIN'],
    ['explain (analyze) with d as (update t set a = 1) select 1', 'EXPLAIN'],
    ['1 + 1', '1'],
  ])('writes: %s', (sql, keyword) => {
    expect(classifyStatement(sql)).toMatchObject({ category: 'write', keyword })
  })

  it.each([
    'set default_transaction_read_only = off',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE',
    'reset all',
    'discard all',
  ])('session: %s', (sql) => {
    expect(classifyStatement(sql).category).toBe('session')
  })

  it.each([
    'begin',
    'begin read write',
    'start transaction read write',
    'commit',
    'end',
    'rollback',
    'abort',
    'savepoint a',
  ])('transaction: %s', (sql) => {
    expect(classifyStatement(sql).category).toBe('transaction')
  })
})

describe('checkReadOnly', () => {
  it('allows reads', () => {
    expect(checkReadOnly('select 1', 'postgres')).toMatchObject({ allowed: true })
  })

  it('explains a refusal', () => {
    const verdict = checkReadOnly('select * from t for update', 'postgres')
    expect(verdict.allowed).toBe(false)
    expect(verdict.message).toBe(
      'Blocked by read-only mode: SELECT (FOR UPDATE takes row locks) — only read statements are allowed.',
    )
  })
})

describe('initialAccessMode', () => {
  it('starts production connections read-only', () => {
    expect(initialAccessMode({ production: true })).toBe('read-only')
  })

  it('honours an explicit read-only flag', () => {
    expect(initialAccessMode({ production: false, readOnly: true })).toBe('read-only')
  })

  it('leaves other connections writable', () => {
    expect(initialAccessMode({ production: false })).toBe('read-write')
  })
})
