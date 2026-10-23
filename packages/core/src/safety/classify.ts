import { isSignificant, tokenize, type SqlDialect, type Token } from '../sql/lexer'

/**
 * - `read`: only reads data.
 * - `write`: changes data, schema or server state, or takes row locks.
 * - `session`: changes session settings (`SET`, `RESET`, …).
 * - `transaction`: transaction control (`BEGIN`, `COMMIT`, …).
 */
export type StatementCategory = 'read' | 'write' | 'session' | 'transaction'

export interface Classification {
  category: StatementCategory
  /** Leading keyword, upper-cased, e.g. `SELECT`. Empty for an empty statement. */
  keyword: string
  /** Why a statement that starts like a read is not one. */
  reason?: string
}

const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'VALUES', 'TABLE', 'SHOW', 'DESCRIBE', 'DESC'])
const SESSION_KEYWORDS = new Set(['SET', 'RESET', 'DISCARD', 'USE'])
const TRANSACTION_KEYWORDS = new Set([
  'BEGIN',
  'START',
  'COMMIT',
  'END',
  'ROLLBACK',
  'ABORT',
  'SAVEPOINT',
  'RELEASE',
  'PREPARE',
])
const MODIFYING_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE'])
const STATEMENT_KEYWORDS = new Set([...READ_KEYWORDS, ...MODIFYING_KEYWORDS, 'CREATE', 'EXECUTE'])

/**
 * Classifies a single statement by its tokens. This is the first, client-side layer of read-only
 * mode: it gives an early, readable refusal. It is deliberately strict — anything it does not
 * recognise as a read is not a read. The database-side layers stay authoritative.
 */
export function classifyStatement(text: string, dialect: SqlDialect = 'postgres'): Classification {
  const words = tokenize(text, dialect).filter(isSignificant)
  return classifyTokens(words)
}

function classifyTokens(tokens: Token[]): Classification {
  if (tokens.length === 0) return { category: 'read', keyword: '' }
  // `(SELECT …) UNION (…)` starts with a parenthesis; anything else that does not start with a
  // keyword is unknown, and unknown is never a read.
  const first = tokens.findIndex((t) => t.text !== '(')
  const keyword = wordAt(tokens, first)
  if (!keyword) return { category: 'write', keyword: tokens[0]!.text, reason: 'unrecognised' }

  if (keyword === 'EXPLAIN') return classifyExplain(tokens)
  if (SESSION_KEYWORDS.has(keyword)) return { category: 'session', keyword }
  if (TRANSACTION_KEYWORDS.has(keyword)) return { category: 'transaction', keyword }
  if (!READ_KEYWORDS.has(keyword)) return { category: 'write', keyword }

  const upper = tokens.map((t) => (t.kind === 'word' ? t.text.toUpperCase() : ''))
  if (keyword === 'SELECT' || keyword === 'WITH') {
    if (hasTopLevelInto(tokens, first)) {
      return { category: 'write', keyword, reason: 'SELECT … INTO creates a table' }
    }
    const lock = rowLockClause(upper)
    if (lock) return { category: 'write', keyword, reason: `${lock} takes row locks` }
  }
  const modifying = upper.find((w) => MODIFYING_KEYWORDS.has(w))
  if (modifying) {
    return { category: 'write', keyword, reason: `contains ${modifying}` }
  }
  return { category: 'read', keyword }
}

/** `EXPLAIN` alone only plans; `EXPLAIN ANALYZE` executes the statement, so classify that. */
function classifyExplain(tokens: Token[]): Classification {
  const analyze = tokens.some((t) => t.kind === 'word' && t.text.toUpperCase() === 'ANALYZE')
  const innerAt = tokens.findIndex(
    (t, i) => i > 0 && t.kind === 'word' && STATEMENT_KEYWORDS.has(t.text.toUpperCase()),
  )
  if (!analyze || innerAt === -1) return { category: 'read', keyword: 'EXPLAIN' }
  const inner = classifyTokens(tokens.slice(innerAt))
  return inner.category === 'read'
    ? { category: 'read', keyword: 'EXPLAIN' }
    : { category: 'write', keyword: 'EXPLAIN', reason: `EXPLAIN ANALYZE runs ${inner.keyword}` }
}

/** A statement wrapped in parentheses, like `(SELECT … INTO t)`, starts that many levels deep. */
function hasTopLevelInto(tokens: Token[], leadingParens: number): boolean {
  let depth = -leadingParens
  for (const token of tokens) {
    if (token.text === '(') depth++
    else if (token.text === ')') depth--
    else if (depth === 0 && token.kind === 'word' && token.text.toUpperCase() === 'INTO') {
      return true
    }
  }
  return false
}

function rowLockClause(upper: string[]): string | undefined {
  for (let i = 0; i < upper.length - 1; i++) {
    if (upper[i] !== 'FOR') continue
    const next = upper[i + 1]
    if (next === 'UPDATE' || next === 'SHARE') return `FOR ${next}`
    if (next === 'NO' && upper[i + 2] === 'KEY') return `FOR NO KEY ${upper[i + 3] ?? ''}`.trim()
    if (next === 'KEY' && upper[i + 2] === 'SHARE') return 'FOR KEY SHARE'
  }
  return undefined
}

function wordAt(tokens: Token[], index: number): string | undefined {
  const token = tokens[index]
  return token?.kind === 'word' ? token.text.toUpperCase() : undefined
}
