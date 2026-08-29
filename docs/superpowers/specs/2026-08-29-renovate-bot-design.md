# Renovate bot for automated chart/image updates

## Goal

Get a PR automatically opened whenever a newer version is available for
something this repo runs: a Docker image tag in a chart's `values.yaml`, or a
vendored Helm chart dependency version in a `Chart.yaml`.

## Context

- Repo: `terrorbollen/homelab` on GitHub, deployed via ArgoCD `Application`
  resources under `argocd/apps/*.yaml`, each pointing at `HEAD` of this repo.
- **Only `grafana-dashboards` has `syncPolicy.automated`.** Every other app
  (`media`, `tailscale`, `infisical`, `obsidian-livesync`, `sealed-secrets`,
  `telegraf`, `portfolio`, `promtail`, `local-path-config`, `grafana`) is
  manual-sync only — confirmed live: the `tailscale` app is currently
  `OutOfSync` because nobody has clicked Sync since its last chart bump.
  **Merging a PR to `main` does not deploy anything by itself** for any of
  these; a human runs `argocd app sync <name>` (or clicks Sync in the UI)
  afterward. This is why automerge is acceptable for image-tag bumps: the
  actual cluster rollout still has a manual gate downstream of the merge.
- No `.github/` directory exists yet — no CI of any kind runs in this repo
  today.
- Images are declared two ways:
  - Directly, as `image: {repository, tag}` in a chart's `values.yaml`
    (Renovate's built-in `helm-values` manager).
  - Indirectly, as a vendored Helm chart dependency listed under
    `dependencies:` in `Chart.yaml`, resolved into `Chart.lock` and a
    `.tgz` archive checked into `charts/<name>/charts/` (Renovate's
    built-in `helmv3` manager).
- Most `Chart.yaml` dependencies are pinned to `version: "*"` (wildcard),
  which Renovate cannot bump — there's no concrete "from" version to diff
  against. `Chart.lock` already resolves each of these to a concrete
  version as of the most recent `helm dependency update` run (2026-08-29),
  and the matching `.tgz` files are already vendored in the working tree.
- Several `values.yaml` image tags are `latest` (or unset, falling back to
  whatever the chart's own default is) for the same reason: no ordering
  to compare against.

## Scope

**In scope:** both `values.yaml` image tags (`helm-values`/`docker`
datasource) and `Chart.yaml` chart dependency versions (`helmv3`/`helm`
datasource), repo-wide.

**Out of scope / explicitly decided against:**
- Self-hosting Renovate in the k3s cluster, or using the hosted Renovate
  GitHub App — using a scheduled GitHub Actions workflow instead (free for
  this workload regardless of repo visibility, zero cluster resources,
  nothing extra to operate).
- Automerging chart-dependency-version bumps (`helm` datasource) — these
  change upstream chart templates/CRDs/defaults, not just a running
  container, so they always get manual review regardless of semver level.

## One-time prep: pin every floating version

This has to land *before* Renovate is turned on, otherwise there's nothing
for it to diff against (a wildcard or `latest` has no "current version" to
compare a new release to).

### `Chart.yaml` dependency versions (`"*"` → concrete)

Copied directly from each chart's already-regenerated `Chart.lock` — no
external lookup needed, pure pin, no version change:

| Chart | Dependency | Pin to |
|---|---|---|
| `charts/descheduler/Chart.yaml` | `descheduler` | `0.32.2` |
| `charts/infiscal/Chart.yaml` | `infisical-standalone` | `1.7.2` |
| `charts/tailscale/Chart.yaml` | `tailscale-operator` | `1.98.9` |
| `charts/media-server/Chart.yaml` | `emby` | `0.1.0` |
| `charts/media-server/Chart.yaml` | `prowlarr` | `4.5.2` |
| `charts/media-server/Chart.yaml` | `radarr` | `0.1.0` |
| `charts/media-server/Chart.yaml` | `sonarr` | `0.1.0` |
| `charts/media-server/Chart.yaml` | `seerr-chart` | `3.9.1` |
| `charts/media-server/Chart.yaml` | `bazarr` | `24.8.1` |
| `charts/media-server/Chart.yaml` | `jellyfin` | `23.7.4` |

(`couchdb` and `sealed-secrets` are already pinned to real versions — no
change needed.)

### Docker image tags (`latest`/unset → concrete)

Looked up from the actual running pods (via `kubectl exec` / pod image
introspection) so the pin matches what's live today, and each confirmed to
exist as a real tag on its registry:

| File | Image | Pin to |
|---|---|---|
| `charts/media-server/values.yaml` | `linuxserver/emby` | `4.8.11.0` |
| `charts/media-server/values.yaml` | `linuxserver/prowlarr` | `2.0.5.5160-ls125` |
| `charts/media-server/values.yaml` | `linuxserver/radarr` | `5.26.2.10099-ls281` |
| `charts/media-server/values.yaml` | `linuxserver/sonarr` | `4.0.15.2941-ls290` |
| `charts/tailscale/values.yaml` | `tailscale/k8s-operator` (`operatorConfig.image`) | `v1.98.9` |
| `charts/tailscale/values.yaml` | `tailscale/tailscale` (`proxyConfig.image`) | `v1.98.9` |
| `charts/obsidian-livesync/values.yaml` | `curlimages/curl` (setup hook, no live instance to check) | `8.21.0` |

Note on `charts/tailscale/values.yaml`: the vendored `tailscale-operator`
chart's template does `.Values.operatorConfig.image.tag | default
.Chart.AppVersion` — i.e. leaving `tag` unset would make it silently track
the chart's `AppVersion` automatically. Setting it to an explicit `"latest"`
(as it is today) actually breaks that auto-tracking and pins to whatever
"latest" resolves to at pull time instead. Pinning to `v1.98.9` here makes
that explicit and gives Renovate something concrete to manage going
forward, at the cost of the image tag and the chart version being two
independently-tracked things from now on rather than one following the
other automatically.

## Components

### `.github/workflows/renovate.yml`

- Triggers: cron schedule + manual `workflow_dispatch` (for testing and
  on-demand runs).
- Runs `renovatebot/github-action@v46`.
- Auth: default `${{ secrets.GITHUB_TOKEN }}` — no PAT or GitHub App
  needed since there's no branch protection on this repo to get in the
  way. Revisit if branch protection is added later.
- Permissions: `contents: write`, `pull-requests: write`.

### `renovate.json` (repo root)

- `extends: ["config:recommended"]`
- `packageRules`:
  - `matchDatasources: ["docker"]`, `matchUpdateTypes: ["patch", "minor"]`
    → `automerge: true` (image tag bumps only).
  - `matchDatasources: ["docker"]`, `matchUpdateTypes: ["major"]`
    → `automerge: false` (default, kept explicit for clarity).
  - `matchDatasources: ["helm"]` → `automerge: false` (chart dependency
    version bumps, always manual).
- `postUpdateOptions: ["helmUpdateSubChartArchives"]` — required so that a
  `Chart.yaml` version bump also regenerates `Chart.lock` and refreshes
  the vendored `.tgz` in `charts/<name>/charts/` within the same PR,
  instead of leaving the archive stale/mismatched. Needs the `helm`
  binary available in the run; Renovate's own container image bundles
  common tool binaries for this purpose. If the first real chart-bump PR
  fails to refresh the archive, add an explicit `setup-helm` step to the
  workflow — a follow-up fix, not a redesign.
- `dependencyDashboard: true` (default) — one issue tracking everything
  pending, useful as a manual-trigger fallback too.
- `schedule`: `["before 6am on monday"]` (Renovate's schedule syntax,
  translates to a weekly run) to start; easy to tighten later once the
  noise level is known.

## Data flow

1. Cron fires (or someone runs the workflow manually).
2. Renovate checks out the repo.
3. `helm-values` manager finds every `image: {repository, tag}` pair in
   `**/values.yaml`; `helmv3` manager finds every entry under
   `dependencies:` in `**/Chart.yaml`.
4. For each, Renovate queries the relevant datasource (Docker Hub/OCI
   registry for images, the chart's Helm repo index for chart deps) for
   newer versions.
5. Opens/updates one branch + PR per outdated dependency.
6. Docker patch/minor PRs automerge after Renovate's own internal checks;
   docker major PRs and all helm chart-version PRs wait for manual
   review (or a checkbox click in the Dependency Dashboard issue).
7. Merging to `main` does **not** deploy — the relevant ArgoCD app stays
   `OutOfSync` until someone runs `argocd app sync <name>`.

## Rollout / verification plan

1. Land the one-time pin commit by itself (table above). Verify
   `helm template` renders byte-identical output for every affected chart
   before/after — proves it's a pure text pin with zero behavior change.
2. Add `renovate.json` + the workflow file. Trigger once manually via
   `workflow_dispatch` and confirm it authenticates and either opens real
   dependency PRs or the Dependency Dashboard issue (no onboarding PR,
   since config already exists at onboarding time).
3. Watch one automerged image patch/minor PR and one manual-review
   chart-version PR go all the way through before considering this done.
