import type { CellValue, ResultColumn } from '@bulkhead/core'

export function cellText(value: CellValue): string {
  return value === null ? '' : String(value)
}

/** Tab-separated with a header row; pastes cleanly into spreadsheets. */
export function toTsv(columns: ResultColumn[], rows: CellValue[][]): string {
  const escape = (value: CellValue) => cellText(value).replace(/[\t\r\n]+/g, ' ')
  return [columns.map((c) => c.name), ...rows]
    .map((row) => row.map((value) => escape(value)).join('\t'))
    .join('\n')
}

/** Array of objects; duplicate column names get a numeric suffix so no value is lost. */
export function toJson(columns: ResultColumn[], rows: CellValue[][]): string {
  const seen = new Map<string, number>()
  const keys = columns.map(({ name }) => {
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}_${count + 1}`
  })
  const objects = rows.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])))
  return JSON.stringify(objects, null, 2)
}
