import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the worker keeps the bridge copy and its instance files. Not the plugin folder: Orca
 * replaces that on every update, and agents keep the bridge path in their config.
 * `BULKHEAD_ORCA_DIR` points tests at a temporary folder.
 */
export function bulkheadOrcaDir(env = process.env, platform = process.platform): string {
  if (env.BULKHEAD_ORCA_DIR) return env.BULKHEAD_ORCA_DIR
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'bulkhead-orca')
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'bulkhead-orca')
  }
  return join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'bulkhead-orca')
}
