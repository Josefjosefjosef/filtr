# NDIC staging two-phase preflight

## Problem

Incident run `31118898675` cancelled job `offline-guards` on `ubuntu-latest` with annotation:

> The job was not acquired by Runner of type hosted even after multiple attempts

`runner_name` empty, `steps=[]`, logs `BlobNotFound`, duration ≈ `timeout-minutes: 15`.
The self-hosted NDIC network job was skipped. Operators had already started the VPS runner
while GitHub-hosted capacity was unavailable — unnecessary egress exposure window.

## Contract

1. **NDIC staging preflight** (`ndic-datex-v1-staging-preflight.yml`)
   - `runs-on: ubuntu-latest`
   - no `IU_NDIC_*` secrets
   - no NDIC network / prod-sync
   - publishes commit status context `ndic-staging-preflight` bound to exact HEAD + expiry
2. **Update NDIC DATEX v1** (`update-ndic-datex-v1.yml`)
   - `ndic-prep` (network/parse/candidate) on `self-hosted` + `Linux` + `X64` + `ndic-cz-egress`
   - `ndic-shared-write` (critical RMW/commit) on the **same** Czech labels under `info-events-data-writers`
   - **no** `ubuntu-latest` job in this workflow (no GitHub-hosted secrets/network/shared-write)
   - verifies valid preflight attestation for `github.sha` **before** NDIC secrets/sync
   - still refuses GitHub-hosted identity (`REFUSING_GITHUB_HOSTED`)

## Operator sequence

1. Keep VPS runner **offline/disabled**
2. Dispatch **NDIC staging preflight** for the exact audited HEAD
3. Wait for `PREFLIGHT_PASS=YES` + attestation id
4. Start VPS runner
5. Dispatch **Update NDIC DATEX v1** (`mode=shadow`) once
6. Stop and disable VPS runner immediately
7. Never retry/rerun a failed incident run; authorize a new dispatch only

## Non-goals

- No automatic `workflow_run` network trigger
- No publication / production deploy defaults ON
- No weakening of `REFUSING_GITHUB_HOSTED_PATH`
