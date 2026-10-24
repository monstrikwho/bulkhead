// Downloads VS Code (cached in .vscode-test/) and runs out/test inside a real extension host.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runTests } from '@vscode/test-electron'

const extensionDevelopmentPath = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// A fresh, short profile path: macOS caps IPC socket paths at 103 characters.
const userDataDir = mkdtempSync(join(tmpdir(), 'bh-'))

try {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? 'stable',
    extensionDevelopmentPath,
    extensionTestsPath: resolve(extensionDevelopmentPath, 'out/test/index.js'),
    // The smoke test finds the MCP instance file in the profile's global storage.
    extensionTestsEnv: { BULKHEAD_TEST_USER_DATA: userDataDir },
    launchArgs: [
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${userDataDir}`,
    ],
  })
} finally {
  rmSync(userDataDir, { recursive: true, force: true })
}
