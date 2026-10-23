export type SqlDialect = 'postgres' | 'clickhouse'

export type TokenKind =
  | 'word'
  | 'quoted-identifier'
  | 'string'
  | 'number'
  | 'comment'
  | 'whitespace'
  | 'semicolon'
  | 'punctuation'

export interface Token {
  kind: TokenKind
  text: string
  start: number
  end: number
}

const WORD_START = /[A-Za-z_\u0080-￿]/
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/
const DIGIT = /[0-9]/
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/

/**
 * A forgiving SQL tokenizer. It never throws: unterminated strings and comments run to the end
 * of the input, which is what a statement splitter and a safety classifier need — they must
 * agree with the server about where quoted text ends, not validate the SQL.
 */
export function tokenize(sql: string, dialect: SqlDialect = 'postgres'): Token[] {
  const tokens: Token[] = []
  let i = 0

  const push = (kind: TokenKind, end: number) => {
    tokens.push({ kind, text: sql.slice(i, end), start: i, end })
    i = end
  }

  while (i < sql.length) {
    const ch = sql[i]!
    const next = sql[i + 1]

    if (/\s/.test(ch)) {
      let end = i + 1
      while (end < sql.length && /\s/.test(sql[end]!)) end++
      push('whitespace', end)
    } else if (ch === '-' && next === '-') {
      const newline = sql.indexOf('\n', i)
      push('comment', newline === -1 ? sql.length : newline)
    } else if (ch === '#' && dialect === 'clickhouse') {
      const newline = sql.indexOf('\n', i)
      push('comment', newline === -1 ? sql.length : newline)
    } else if (ch === '/' && next === '*') {
      push('comment', blockCommentEnd(sql, i, dialect === 'postgres'))
    } else if (ch === "'") {
      push('string', quotedEnd(sql, i, "'", dialect === 'clickhouse'))
    } else if ((ch === 'e' || ch === 'E') && next === "'" && dialect === 'postgres') {
      push('string', quotedEnd(sql, i + 1, "'", true))
    } else if (ch === '"') {
      push('quoted-identifier', quotedEnd(sql, i, '"', dialect === 'clickhouse'))
    } else if (ch === '`' && dialect === 'clickhouse') {
      push('quoted-identifier', quotedEnd(sql, i, '`', true))
    } else if (ch === '$' && dialect === 'postgres' && DOLLAR_TAG.test(sql.slice(i, i + 64))) {
      const tag = DOLLAR_TAG.exec(sql.slice(i, i + 64))![0]
      const close = sql.indexOf(tag, i + tag.length)
      push('string', close === -1 ? sql.length : close + tag.length)
    } else if (WORD_START.test(ch)) {
      let end = i + 1
      while (end < sql.length && WORD_PART.test(sql[end]!)) end++
      push('word', end)
    } else if (DIGIT.test(ch) || (ch === '.' && next !== undefined && DIGIT.test(next))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i))!
      push('number', i + match[0].length)
    } else if (ch === ';') {
      push('semicolon', i + 1)
    } else {
      push('punctuation', i + 1)
    }
  }

  return tokens
}

export function isSignificant(token: Token): boolean {
  return token.kind !== 'whitespace' && token.kind !== 'comment'
}

function blockCommentEnd(sql: string, start: number, nested: boolean): number {
  let depth = 0
  let i = start
  while (i < sql.length) {
    if (sql[i] === '/' && sql[i + 1] === '*') {
      depth = nested ? depth + 1 : 1
      i += 2
    } else if (sql[i] === '*' && sql[i + 1] === '/') {
      depth--
      i += 2
      if (depth === 0) return i
    } else {
      i++
    }
  }
  return sql.length
}

/** Finds the end of a quoted run; a doubled quote is an escaped quote in every dialect. */
function quotedEnd(sql: string, openAt: number, quote: string, backslashEscapes: boolean): number {
  let i = openAt + 1
  while (i < sql.length) {
    const ch = sql[i]
    if (backslashEscapes && ch === '\\') {
      i += 2
    } else if (ch === quote) {
      if (sql[i + 1] === quote) i += 2
      else return i + 1
    } else {
      i++
    }
  }
  return sql.length
}
