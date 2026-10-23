import { readdirSync } from 'node:fs'
import * as path from 'node:path'

import Mocha from 'mocha'

/** Entry point VS Code calls inside the extension host (see scripts/run-e2e.mjs). */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20_000 })
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.test.js'))) {
    mocha.addFile(path.join(__dirname, file))
  }
  const failures = await new Promise<number>((resolve) => mocha.run(resolve))
  if (failures > 0) throw new Error(`${failures} test(s) failed`)
}
