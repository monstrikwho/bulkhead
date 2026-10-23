import { isSignificant, tokenize, type SqlDialect, type Token } from './lexer'

export interface SqlStatement {
  /** Statement text without the trailing semicolon. */
  text: string
  /** Offset of the first non-whitespace character (comments included). */
  start: number
  /** Offset right after the last non-whitespace character, before the semicolon. */
  end: number
}

/**
 * Splits a script into statements on top-level semicolons. Semicolons inside strings, quoted
 * identifiers, dollar-quoted bodies, comments and SQL-standard `BEGIN ATOMIC … END` function
 * bodies do not split. Statements made only of comments are dropped.
 */
export function splitStatements(sql: string, dialect: SqlDialect = 'postgres'): SqlStatement[] {
  const tokens = tokenize(sql, dialect)
  const statements: SqlStatement[] = []
  let current: Token[] = []
  let atomicDepth = 0
  let caseDepth = 0
  let previousWord = ''

  const flush = () => {
    const statement = toStatement(sql, current)
    if (statement) statements.push(statement)
    current = []
  }

  for (const token of tokens) {
    if (token.kind === 'semicolon' && atomicDepth === 0) {
      flush()
      previousWord = ''
      continue
    }
    current.push(token)

    if (token.kind !== 'word') continue
    const word = token.text.toUpperCase()
    if (word === 'ATOMIC' && previousWord === 'BEGIN') {
      atomicDepth++
    } else if (atomicDepth > 0 && word === 'CASE') {
      caseDepth++
    } else if (atomicDepth > 0 && word === 'END') {
      if (caseDepth > 0) caseDepth--
      else atomicDepth--
    }
    previousWord = word
  }
  flush()

  return statements
}

/** Returns the statement under the cursor, or the closest one before it. */
export function statementAt(statements: readonly SqlStatement[], offset: number) {
  let candidate: SqlStatement | undefined
  for (const statement of statements) {
    if (statement.start > offset) break
    candidate = statement
  }
  return candidate ?? statements[0]
}

function toStatement(sql: string, tokens: Token[]): SqlStatement | undefined {
  if (!tokens.some(isSignificant)) return undefined
  const first = tokens.find((t) => t.kind !== 'whitespace')!
  const last = tokens.findLast((t) => t.kind !== 'whitespace')!
  return { text: sql.slice(first.start, last.end), start: first.start, end: last.end }
}
