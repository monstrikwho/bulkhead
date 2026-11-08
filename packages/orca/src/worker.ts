import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { OrcaWorker } from './orcaApi'
import { bulkheadOrcaDir } from './paths'
import { BulkheadOrca } from './plugin'

/** Replaced by the build with the version of the release. */
declare const BULKHEAD_VERSION: string

let plugin: BulkheadOrca | undefined

/**
 * The worker Orca forks for this plugin. The status bar item in the manifest keeps it running
 * while the plugin is enabled, so the MCP server is not stopped after idle minutes.
 */
export default function activate(orca: OrcaWorker): void {
  const here = dirname(fileURLToPath(import.meta.url))
  plugin = new BulkheadOrca(orca, {
    storageDir: bulkheadOrcaDir(),
    bridgeSource: join(here, 'mcp-bridge.js'),
    version: BULKHEAD_VERSION,
  })
  void plugin.whenReady().then(
    () => orca.log(`ready, Node ${process.version}, runtime ${process.execPath}`),
    (error: unknown) => orca.log(`failed to start: ${String(error)}`),
  )
}

/** Orca gives this 2 s before SIGKILL: close sessions and tunnels, remove the instance file. */
export async function deactivate(): Promise<void> {
  await plugin?.dispose()
  plugin = undefined
}
