# 0009. SSH tunnels through the system OpenSSH client

Status: accepted · 2026-11-08

## Context

Production databases usually sit behind a bastion. The roadmap planned an SSH transport on the
`ssh2` library. People who reach such databases already have a working `ssh` setup: aliases,
`ProxyJump` chains, `IdentityFile`, agents, hardware keys and their own `known_hosts`, all in
`~/.ssh/config`. A library has to re-implement every one of those features to behave the same,
and one it gets wrong breaks the connection or, worse, weakens host key checking. It would also
ship a second SSH stack inside the extension.

## Decision

- The `ssh` transport (`host/src/transport/ssh.ts`) spawns the system `ssh` for local port
  forwarding: `ssh -N -L 127.0.0.1:<free port>:<db host>:<db port> -- <destination>`, then
  waits until the local port accepts. Drivers connect to that local endpoint and need no change.
- The profile stores the destination (`[user@]host[:port]` or an alias) and optionally an
  identity file; everything else comes from the user's ssh configuration.
- `BatchMode=yes` and `ExitOnForwardFailure=yes`: ssh never prompts, so it never asks for a
  password and never accepts an unknown host key for the user (the user's own
  `StrictHostKeyChecking` applies). There is no terminal to prompt in; the error tells the user
  to run `ssh <host>` once in a terminal.
- A destination starting with `-` is refused by the schema and passed after `--`, so a profile
  or an agent cannot turn it into an ssh option.
- The tunnel reports ssh's own reason when the driver only sees a reset socket ("the SSH server
  could not reach host:port"), and ssh is killed when the session closes.

## Consequences

- `~/.ssh/config`, jump hosts and agents work exactly as in the user's terminal; Bulkhead ships
  no SSH code or native module.
- Password and passphrase prompts are not supported: the key must load without a prompt. VS Code
  passes `SSH_AUTH_SOCK`, so an agent works there; Orca's worker environment has no
  `SSH_AUTH_SOCK`, so in Orca the key must load without a passphrase prompt.
- Needs an `ssh` on `PATH` (built into macOS, Linux and Windows 10+).
- If the host process is killed hard (SIGKILL), its ssh children may outlive it until their
  connection drops.
