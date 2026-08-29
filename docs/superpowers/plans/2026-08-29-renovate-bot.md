# Renovate Bot for Automated Chart/Image Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get Renovate opening PRs automatically whenever a newer version exists for a Docker image tag in a chart's `values.yaml`, or a vendored Helm chart dependency in a `Chart.yaml`.

**Architecture:** A scheduled GitHub Actions workflow runs `renovatebot/github-action`, driven by a `renovate.json` at the repo root. Before it can do anything useful, every currently-floating version (`Chart.yaml` `version: "*"` wildcards, `values.yaml` `tag: latest`/unset tags) must be pinned to a concrete value, since Renovate needs a "from" version to diff against.

**Tech Stack:** Renovate (`renovatebot/github-action@v46.2.4`), GitHub Actions, Helm v3 chart format.

**Spec:** `docs/superpowers/specs/2026-08-29-renovate-bot-design.md`

## Global Constraints

- Automerge only for `datasource=docker` (image tag) updates at `patch`/`minor` level. Never automerge `datasource=helm` (chart dependency version) updates, and never automerge `major` image updates.
- `postUpdateOptions: ["helmUpdateSubChartArchives"]` must be set so chart-version bumps also refresh `Chart.lock` and the vendored `.tgz`, not just the version string.
- Use the default `${{ secrets.GITHUB_TOKEN }}` for auth — no PAT, no GitHub App.
- Every pin in Tasks 1-2 must match a value already confirmed live (either in `Chart.lock` or the running pod) — see the table in the spec. Do not substitute a different "latest available" version.

---

## Task 1: Pin `Chart.yaml` dependency versions from `"*"` to the resolved value in `Chart.lock`

**Files:**
- Modify: `charts/media-server/Chart.yaml:8-28`
- Modify: `charts/descheduler/Chart.yaml:7-10`
- Modify: `charts/infiscal/Chart.yaml:7-10`
- Modify: `charts/tailscale/Chart.yaml:7-10`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: concrete dependency versions in `Chart.yaml` that Task 3's `renovate.json` (`datasource: helm` package rule) will manage going forward. Task 4's rollout step depends on this being merged first — otherwise there's nothing for Renovate to bump.

This is a pure text pin: `helm template` reads the already-vendored `.tgz` files in each chart's `charts/` subdirectory regardless of what `Chart.yaml` declares, so the rendered output must not change at all.

- [ ] **Step 1: Capture baseline `helm template` output for all four charts**

```bash
mkdir -p /tmp/renovate-verify
for c in media-server descheduler infiscal tailscale; do
  helm template charts/$c > /tmp/renovate-verify/${c}-before.yaml
done
```

Expected: four files written, no errors (all four charts already render cleanly with exit code 0).

- [ ] **Step 2: Edit `charts/media-server/Chart.yaml`**

Replace the `dependencies:` block (currently every entry has `version: "*"`) with the versions from `charts/media-server/Chart.lock`:

```yaml
dependencies:
  - name: emby
    version: "0.1.0"
    repository: https://bananaspliff.github.io/geek-charts/
  - name: prowlarr
    version: "4.5.2"
    repository: https://k8s-at-home.com/charts/
  - name: radarr
    version: "0.1.0"
    repository: https://bananaspliff.github.io/geek-charts/
  - name: sonarr
    version: "0.1.0"
    repository: https://bananaspliff.github.io/geek-charts/
  - name: seerr-chart
    version: "3.9.1"
    repository: oci://ghcr.io/seerr-team/seerr
  - name: bazarr
    version: "24.8.1"
    repository: oci://oci.trueforge.org/truecharts
  - name: jellyfin
    version: "23.7.4"
    repository: oci://oci.trueforge.org/truecharts
```

(Only the `version:` values change; keep `name:`/`repository:` exactly as they are. Trailing spaces after `seerr-chart ` and `jellyfin ` in the original file are pre-existing and fine to leave or trim — not part of this change either way.)

- [ ] **Step 3: Edit `charts/descheduler/Chart.yaml`**

```yaml
dependencies:
  - name: descheduler
    version: "0.32.2"
    repository: https://kubernetes-sigs.github.io/descheduler
```

- [ ] **Step 4: Edit `charts/infiscal/Chart.yaml`**

```yaml
dependencies:
  - name: infisical-standalone
    version: "1.7.2"
    repository: https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/
```

- [ ] **Step 5: Edit `charts/tailscale/Chart.yaml`**

```yaml
dependencies:
  - name: tailscale-operator
    version: "1.98.9"
    repository: https://pkgs.tailscale.com/helmcharts
```

- [ ] **Step 6: Re-render and diff against baseline**

```bash
for c in media-server descheduler infiscal tailscale; do
  helm template charts/$c > /tmp/renovate-verify/${c}-after.yaml
  echo "=== $c ==="
  diff /tmp/renovate-verify/${c}-before.yaml /tmp/renovate-verify/${c}-after.yaml
done
```

Expected: no output from any of the four `diff` calls (empty diff = pass). If any chart shows a diff, stop — that means the vendored `.tgz` doesn't actually match the version you just pinned, and the pin is wrong.

- [ ] **Step 7: Commit**

```bash
git add charts/media-server/Chart.yaml charts/descheduler/Chart.yaml charts/infiscal/Chart.yaml charts/tailscale/Chart.yaml
git commit -m "Pin Helm chart dependency versions instead of wildcarding them

Copied straight from each chart's already-resolved Chart.lock -- no
behavior change, just gives Renovate something concrete to diff
against and bump later."
```

---

## Task 2: Pin `values.yaml` image tags from `latest`/unset to the currently-running version

**Files:**
- Modify: `charts/media-server/values.yaml:78-80` (emby), `:114-117` (prowlarr), `:149-151` (radarr), `:203-206` (sonarr)
- Modify: `charts/tailscale/values.yaml:29-33` (operatorConfig.image), `:41-45` (proxyConfig.image)
- Modify: `charts/obsidian-livesync/values.yaml:19-24` (autoSetup.image)

**Interfaces:**
- Consumes: nothing from Task 1 (different files), but logically part of the same "prep before Renovate goes live" phase.
- Produces: concrete image tags in `values.yaml` that Task 3's `renovate.json` (`datasource: docker` package rule) will manage going forward.

Unlike Task 1, this **does** change rendered output — the literal tag string appears in each Deployment's `image:` field. The check here is: the diff shows *only* the expected tag substitution (old tag/no tag → new pinned tag), nothing else, and the new tag matches what's actually running today (already confirmed live via `kubectl exec`/pod image inspection during design — see the spec's prep table).

- [ ] **Step 1: Capture baseline `helm template` output for all three charts**

```bash
for c in media-server tailscale obsidian-livesync; do
  helm template charts/$c > /tmp/renovate-verify/${c}-before2.yaml
done
```

- [ ] **Step 2: Edit `charts/media-server/values.yaml`**

Emby (currently no `tag:` key at all — add one), at line 78-80:

```yaml
  image:
    repository: linuxserver/emby
    tag: "4.8.11.0"
    pullPolicy: IfNotPresent
```

Prowlarr, at line 114-117 (change `tag: latest` → pinned):

```yaml
  image:
    repository: linuxserver/prowlarr
    tag: "2.0.5.5160-ls125"
    pullPolicy: IfNotPresent
```

Radarr (currently no `tag:` key — add one), at line 149-151:

```yaml
  image:
    repository: linuxserver/radarr
    tag: "5.26.2.10099-ls281"
    pullPolicy: IfNotPresent
```

Sonarr, at line 203-206 (change `tag: latest` → pinned):

```yaml
  image:
    repository: linuxserver/sonarr
    tag: "4.0.15.2941-ls290"
    pullPolicy: IfNotPresent
```

- [ ] **Step 3: Edit `charts/tailscale/values.yaml`**

`operatorConfig.image`, at line 29-33 (change `tag: "latest"` → pinned):

```yaml
  image:
    repository: tailscale/k8s-operator
    tag: "v1.98.9"
    digest: ""
    pullPolicy: Always
```

`proxyConfig.image`, at line 41-45 (change `tag: "latest"` → pinned):

```yaml
  image:
    repository: tailscale/tailscale
    tag: "v1.98.9"
    digest: ""
```

- [ ] **Step 4: Edit `charts/obsidian-livesync/values.yaml`**

`autoSetup.image`, at line 19-24 (change `tag: latest` → pinned):

```yaml
    image:
      repository: curlimages/curl
      tag: "8.21.0"
      pullPolicy: Always
```

- [ ] **Step 5: Re-render and check the diff is exactly the tag substitutions, nothing else**

```bash
for c in media-server tailscale obsidian-livesync; do
  helm template charts/$c > /tmp/renovate-verify/${c}-after2.yaml
  echo "=== $c ==="
  diff /tmp/renovate-verify/${c}-before2.yaml /tmp/renovate-verify/${c}-after2.yaml
done
```

Expected diffs, and nothing beyond them:
- `media-server`: four `image:` lines change — `linuxserver/emby:latest` → `linuxserver/emby:4.8.11.0`, `linuxserver/prowlarr:latest` → `linuxserver/prowlarr:2.0.5.5160-ls125`, `linuxserver/radarr:latest` → `linuxserver/radarr:5.26.2.10099-ls281`, `linuxserver/sonarr:latest` → `linuxserver/sonarr:4.0.15.2941-ls290`. (Emby and radarr have no `tag:` key set today, but both subcharts already default the tag to `latest` when it's unset — confirmed in the current rendered output — so the diff is the same `latest` → pinned-version substitution for all four.)
- `tailscale`: two `image:` lines change — `tailscale/k8s-operator:latest` → `tailscale/k8s-operator:v1.98.9`, `tailscale/tailscale:latest` → `tailscale/tailscale:v1.98.9`.
- `obsidian-livesync`: one `image:` line changes — `curlimages/curl:latest` → `curlimages/curl:8.21.0`.

If a diff shows anything else changing (replica counts, env vars, resource limits, etc.), stop and figure out why before continuing — that means the edit touched more than the `tag:` field.

- [ ] **Step 6: Commit**

```bash
git add charts/media-server/values.yaml charts/tailscale/values.yaml charts/obsidian-livesync/values.yaml
git commit -m "Pin docker image tags instead of floating on latest/unset

Tags match what's actually running today (checked via kubectl exec /
pod image inspection), confirmed to exist on their registries. Gives
Renovate something concrete to diff against and bump later."
```

---

## Task 3: Add `renovate.json`

**Files:**
- Create: `renovate.json`

**Interfaces:**
- Consumes: nothing directly, but is only meaningful once Task 1 and Task 2 have landed (otherwise most dependencies have nothing to bump from).
- Produces: the Renovate configuration that Task 4's workflow file will pick up automatically (Renovate auto-discovers `renovate.json` at the repo root — no reference needed from the workflow file itself).

- [ ] **Step 1: Create `renovate.json`**

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "dependencyDashboard": true,
  "schedule": ["before 6am on monday"],
  "postUpdateOptions": ["helmUpdateSubChartArchives"],
  "packageRules": [
    {
      "description": "Automerge patch/minor docker image tag bumps",
      "matchDatasources": ["docker"],
      "matchUpdateTypes": ["patch", "minor"],
      "automerge": true
    },
    {
      "description": "Never automerge major docker image tag bumps",
      "matchDatasources": ["docker"],
      "matchUpdateTypes": ["major"],
      "automerge": false
    },
    {
      "description": "Never automerge Helm chart dependency version bumps",
      "matchDatasources": ["helm"],
      "automerge": false
    }
  ]
}
```

- [ ] **Step 2: Validate the config is syntactically valid and matches Renovate's schema**

```bash
npx --yes --package renovate -- renovate-config-validator renovate.json
```

Expected: output ending in something like `renovate.json validated` / `Config validated successfully`, exit code 0. If `npx` isn't available, at minimum confirm it's valid JSON:

```bash
python3 -c "import json; json.load(open('renovate.json'))" && echo "valid JSON"
```

- [ ] **Step 3: Commit**

```bash
git add renovate.json
git commit -m "Add Renovate config

Automerges patch/minor docker image tag bumps; leaves major image
bumps and all Helm chart dependency version bumps for manual review.
postUpdateOptions refreshes Chart.lock + vendored .tgz archives
alongside chart version bumps."
```

---

## Task 4: Add the GitHub Actions workflow

**Files:**
- Create: `.github/workflows/renovate.yml`

**Interfaces:**
- Consumes: `renovate.json` from Task 3 (auto-discovered by the action, not referenced by path).
- Produces: the scheduled/manually-triggerable job that Task 5's rollout verification runs against.

- [ ] **Step 1: Create `.github/workflows/renovate.yml`**

```yaml
name: Renovate

on:
  schedule:
    - cron: "0 5 * * 1"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  renovate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Renovate
        uses: renovatebot/github-action@v46.2.4
        with:
          token: "${{ secrets.GITHUB_TOKEN }}"
```

- [ ] **Step 2: Validate the workflow YAML is syntactically valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/renovate.yml'))" && echo "valid YAML"
```

Expected: `valid YAML`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/renovate.yml
git commit -m "Add scheduled GitHub Actions workflow to run Renovate

Weekly cron (Monday 05:00 UTC) plus workflow_dispatch for manual runs.
Uses the default GITHUB_TOKEN -- no PAT needed since this repo has no
branch protection yet."
```

---

## Task 5: Push and verify the first real Renovate run

**Files:** none (verification only — no code changes).

**Interfaces:**
- Consumes: everything from Tasks 1-4, already merged to `main`.
- Produces: confirmation that Renovate is actually live, closing out the plan.

This task pushes to the remote and triggers a GitHub Actions run — both visible, hard-to-fully-reverse actions. Confirm with the user before running Steps 1-2 if this plan is being executed autonomously.

- [ ] **Step 1: Push the four commits from Tasks 1-4 to `main`**

```bash
git push origin main
```

Expected: push succeeds, no force-push needed (this plan only adds commits on top of the current `main`).

- [ ] **Step 2: Trigger the workflow manually rather than waiting for Monday**

```bash
gh workflow run renovate.yml
```

If `gh` isn't authenticated in this environment, trigger it instead from the GitHub UI: Actions tab → "Renovate" workflow → "Run workflow".

- [ ] **Step 3: Watch the run and confirm it completes successfully**

```bash
gh run watch $(gh run list --workflow=renovate.yml --limit=1 --json databaseId --jq '.[0].databaseId')
```

Expected: run status `completed` / conclusion `success`. If it fails on the chart-dependency step specifically (looking for a `helm` binary or `helmUpdateSubChartArchives` error in the logs), that's the known risk flagged in the spec — the fix is adding an explicit `setup-helm` step to `.github/workflows/renovate.yml` (e.g. `azure/setup-helm@v4`) before the Renovate step, not a redesign.

- [ ] **Step 4: Confirm real output — either open PRs or a populated Dependency Dashboard issue**

```bash
gh pr list --search "renovate"
gh issue list --search "Dependency Dashboard"
```

Expected: at least the Dependency Dashboard issue exists. Whether any PRs already exist depends on whether anything upstream is actually newer than what was just pinned in Tasks 1-2 — that's expected and fine either way; the point of this step is confirming Renovate ran and talked to GitHub successfully, not that it necessarily found something to bump on the first pass.

- [ ] **Step 5: Once any PR appears, confirm the automerge/manual-review split works as designed**

Watch for the *next* real dependency bump (whenever it lands, not necessarily same-day): a `datasource=docker` patch/minor PR should automerge on its own; a `datasource=helm` chart-version PR should sit open for manual review. No commit for this step — it's an observation to close out the rollout, not a code change.
