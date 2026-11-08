export interface Endpoint {
  host: string
  port: number
}

/** An open path to the database. Drivers connect to `endpoint`, never to the original target. */
export interface Tunnel {
  readonly endpoint: Endpoint
  /**
   * Why the tunnel failed, when it knows better than the driver: a driver sees a reset socket
   * where ssh says the server could not reach the database.
   */
  failure?(): string | undefined
  close(): Promise<void>
}

/**
 * Opens tunnels for one transport config. Implementations that need Node (ssh, kubectl) live in
 * `@bulkhead/host`, which picks one per `TransportConfig`.
 */
export interface Transport {
  open(target: Endpoint): Promise<Tunnel>
}

export const directTransport: Transport = {
  open(target) {
    return Promise.resolve({ endpoint: target, close: () => Promise.resolve() })
  },
}
