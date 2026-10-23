import type { Driver } from '@bulkhead/core'

import { parsePostgresConnectionString } from './connectionString'
import { parsePostgresOptions, postgresOptionFields, type PostgresOptions } from './options'
import { PostgresSession } from './session'

export { PostgresSession } from './session'
export { parsePostgresConnectionString } from './connectionString'
export type { PostgresOptions } from './options'

export const postgresDriver: Driver<PostgresOptions> = {
  kind: 'postgres',
  displayName: 'PostgreSQL',
  dialect: 'postgres',
  optionFields: postgresOptionFields,
  secretFields: [{ key: 'password', label: 'Password', optional: true }],
  parseOptions: parsePostgresOptions,
  target: (options) => ({ host: options.host, port: options.port }),
  describe: (options) => `${options.user}@${options.host}:${options.port}/${options.database}`,
  parseConnectionString: parsePostgresConnectionString,
  async connect(request) {
    const session = new PostgresSession(request)
    try {
      await session.open()
    } catch (error) {
      await session.close()
      throw error
    }
    return session
  },
}
