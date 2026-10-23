// vsce packages packages/extension on its own; the license, changelog and readme live at the
// repository root. Copy them in right before packaging.
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const extension = join(root, 'packages', 'extension')

for (const file of ['LICENSE', 'CHANGELOG.md', 'README.md']) {
  copyFileSync(join(root, file), join(extension, file))
}
