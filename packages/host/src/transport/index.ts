import { directTransport, type Transport, type TransportConfig } from '@bulkhead/core'

import { sshTransport, type SshTransportOptions } from './ssh'

export * from './ssh'

export interface TransportOptions {
  ssh?: SshTransportOptions
}

/** The transport a profile asks for. Every host gets the same set. */
export function createTransport(
  config: TransportConfig,
  options: TransportOptions = {},
): Transport {
  switch (config.kind) {
    case 'direct':
      return directTransport
    case 'ssh':
      return sshTransport(config, options.ssh)
  }
}
