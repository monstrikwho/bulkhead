# Roadmap

Stages are ordered; each ends with a release. Estimates are rough and will be revisited.

## 0.1 — Foundation and PostgreSQL _(in progress)_

- [x] Monorepo, CI, release pipeline to Marketplace and Open VSX
- [x] Driver, transport and webview contracts
- [x] PostgreSQL tree, query execution, cancel, results grid
- [x] Production read-only mode in three layers, unlock by typed confirmation
- [x] Connection form as a webview: database picker with hosted presets, pasted connection
      strings, test connection, database list, environment and read-only
- [ ] Connection form: SSL certificate files, connection colour
- [x] Marketplace icon and publisher account (`bulkhead`)
- [ ] Screenshots for the Marketplace page
- [ ] Publish to the Marketplace with Microsoft Entra ID (`vsce publish --azure-credential`)
      instead of `VSCE_PAT`: global Azure DevOps PATs stop working on 1 December 2026
- [ ] SQL autocompletion from schema metadata (tables, columns, keywords)

## 0.2 — Delivery: SSH and Kubernetes

- [ ] SSH tunnel transport (`ssh2`): password, key, agent, jump hosts, `~/.ssh/config` hosts
- [ ] `kubectl port-forward` transport: context, namespace, pod/service, auto-reconnect
- [ ] Generic "command tunnel" (cloud-sql-proxy, AWS SSM, …)

## 0.3 — Table data

- [ ] Open a table with filters and sorting without writing SQL
- [ ] Edit cells, insert and delete rows, with a preview of the generated SQL before applying
- [ ] Foreign key navigation: jump to the referenced row
- [ ] Missing `WHERE` warning for `UPDATE` / `DELETE`
- [ ] Query history; transaction status and explicit commit/rollback in the status bar

## 0.4 — ClickHouse

- [ ] Same tree and editor; table size and engine in the tree; `readonly=1` enforcement

## 0.5 — Redis

- [ ] Key tree by `:` via `SCAN`, type and TTL, viewers/editors for every type, command console
- [ ] Read-only command allow-list

## 0.6 — RabbitMQ

- [ ] vhost → queues with message and consumer counts, peek without losing messages, publish

## Later

- Docker containers and logs
- EXPLAIN plan visualisation
- Export results (CSV, JSON, SQL inserts), import CSV
- Localisation (the code already uses `vscode.l10n`)
