// Loads packages/orca/dist into the running Orca as a dev plugin. A trusted worker needs the
// user's approval: on `approval_required` this prints what it asks for and the exact command,
// and exits 3. Approving is the user's decision, never this script's.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const extra = process.argv.slice(2)
const result = spawnSync('orca', ['plugin', 'dev', 'load', dist, '--json', ...extra], {
  encoding: 'utf8',
})
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
