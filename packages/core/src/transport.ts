import type { TransportConfig } from './connection'

export interface Endpoint {
  host: string
  port: number
}

/** An open path to the database. Drivers connect to `endpoint`, never to the original target. */
export interface Tunnel {
  readonly endpoint: Endpoint
  close(): Promise<void>
}

export interface Transport {
  open(target: Endpoint): Promise<Tunnel>
}

export const directTransport: Transport = {
  open(target) {
    return Promise.resolve({ endpoint: target, close: () => Promise.resolve() })
  },
}

export function createTransport(config: TransportConfig): Transport {
  switch (config.kind) {
    case 'direct':
      return directTransport
  }
}
