---
name: release
description: >-
  Release a new Bulkhead version to the VS Code Marketplace, Open VSX and GitHub Releases. Use
  when asked to "release", "publish", "ship 0.x", "cut a version", or when a release run fails or
  the extension does not show up on a marketplace. Covers versioning, changelog, the tag-driven
  workflow with its approval gate, verification on both marketplaces, and the publishing
  credentials that expire.
---

# Releasing Bulkhead

Releases are tag-driven: pushing `v<version>` runs `.github/workflows/release.yml`, which checks
that the tag matches `packages/extension/package.json`, runs lint/typecheck/unit tests, packages
the VSIX, publishes to the Marketplace (`vsce`, secret `VSCE_PAT`) and Open VSX (`ovsx`, secret
`OVSX_PAT`), and creates a GitHub release with the VSIX attached. The job runs in the `release`
environment: tags `v*` only, and a required reviewer must approve it.

Publishing is outward-facing and cannot be undone (a version number can never be reused). Release
only when the maintainer asked for it.

## Steps

1. **Pick the version.** SemVer; while `0.x`, new features bump the minor, fixes the patch.
2. **Changelog.** In `CHANGELOG.md` move everything under `## [Unreleased]` to
   `## [X.Y.Z] - YYYY-MM-DD`, leave an empty `## [Unreleased]`, and update the compare links at
   the bottom (`[Unreleased]: …/compare/vX.Y.Z...HEAD`, `[X.Y.Z]: …/compare/vPREV...vX.Y.Z`).
3. **Version.** Set `"version"` in `packages/extension/package.json`.
4. **Check locally:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm package`,
   then `unzip -l packages/extension/bulkhead-X.Y.Z.vsix` — expect `dist/extension.js`,
   `dist/webview/index.{js,css}`, `media/`, README, CHANGELOG, LICENSE, and no `out/`, `src/` or
   source maps.
5. **Commit and push** `chore(release): X.Y.Z` to `main`.
6. **Wait for CI on that commit** — all jobs, including the VS Code smoke tests on three OSes:
   ```sh
   gh run list -R monstrikwho/bulkhead --workflow ci.yml --limit 1
   gh run watch <id> -R monstrikwho/bulkhead --exit-status
   ```
   Do not tag a red commit. Fix, push, wait again.
7. **Tag the green commit:** `git tag -a vX.Y.Z <sha> -m "Bulkhead X.Y.Z" && git push origin vX.Y.Z`.
8. **Approve.** The run waits for the `release` environment reviewer. The maintainer approves in
   GitHub → Actions, or, when they asked for the release in chat, through the API:
   ```sh
   id=$(gh run list -R monstrikwho/bulkhead --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
   env=$(gh api repos/monstrikwho/bulkhead/actions/runs/$id/pending_deployments --jq '.[0].environment.id')
   gh api -X POST repos/monstrikwho/bulkhead/actions/runs/$id/pending_deployments \
     -F "environment_ids[]=$env" -f state=approved -f comment="Release X.Y.Z"
   gh run watch $id -R monstrikwho/bulkhead --exit-status
   ```
9. **Verify** (the Marketplace needs a few minutes for its scan; a 404 right after publishing is
   normal):
   ```sh
   gh run view $id -R monstrikwho/bulkhead --log | grep -E "Published|error"
   curl -s -o /dev/null -w "%{http_code}\n" "https://marketplace.visualstudio.com/items?itemName=bulkhead.bulkhead"
   curl -s https://open-vsx.org/api/bulkhead/bulkhead | head -c 300
   gh release view vX.Y.Z -R monstrikwho/bulkhead
   ```

## When it fails

- **Tag does not match the version** → the check step fails before publishing. Delete the tag
  (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`), fix, retag.
- **Marketplace published, Open VSX failed** → do not retag. Publish the attached VSIX by hand
  with the maintainer's token (`npx ovsx publish bulkhead-X.Y.Z.vsix -p …`, run by the
  maintainer), or rerun only the failed job if the run allows it.
- **401/403 from `vsce`** → `VSCE_PAT` expired or was revoked (see below).
- **Never put tokens in chat, files or commands you run.** The maintainer sets secrets with
  `gh secret set VSCE_PAT --env release -R monstrikwho/bulkhead` (it prompts for the value).

## Credentials

- `VSCE_PAT`: Azure DevOps personal access token of a member of the Marketplace publisher
  `bulkhead`, organization "All accessible organizations", scope Marketplace → Manage. Created
  in the Azure DevOps organization `bulkhead-oss`. Such global PATs stop working on
  **1 December 2026**. The replacement is Marketplace trusted publishing: a policy on the
  publisher for `monstrikwho/bulkhead`, workflow `release.yml`, environment `release`, then
  `gh variable set MARKETPLACE_OIDC --body true -R monstrikwho/bulkhead`. The workflow then runs
  `vsce@4 publish --oidc` (needs Node 22, `id-token: write`) and ignores `VSCE_PAT`. Fallback if
  the Marketplace has not launched it in time: Microsoft Entra ID (`--azure-credential`).
- **Trusted publishing fails** (`TrustedPublishingNotSupportedException`, 401/403 from the token
  exchange) → the policy is missing or does not match the repository/workflow/environment.
  Unset the variable (`gh variable delete MARKETPLACE_OIDC -R monstrikwho/bulkhead`) to fall back
  to the PAT while it still works.
- `OVSX_PAT`: Open VSX access token of a member of the `bulkhead` namespace; the account has
  signed the Eclipse Foundation Open VSX Publisher Agreement.
