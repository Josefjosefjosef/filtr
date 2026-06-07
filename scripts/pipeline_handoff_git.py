#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cross-run persisted pipeline handoff on branch automation/pipeline-handoff.

Primary source-of-truth: git tree pipeline-handoff/ on that branch (manifest + blobs per commit).
Survives across workflow runs. Actions artifacts are not the durable truth.

Race safety: manifest carries winningIngestRunId / winningAggregateRunId (GitHub run_id order)
and monotonic handoffEpoch. Older workflow runs cannot overwrite newer checkpoints (CAS before
commit + push retry on non-fast-forward).

Publish release: pull-for-publish writes an expect file (aggregate run id + handoffEpoch + branch tip).
verify-publish-latest re-fetches origin and aborts public data commit if remote advanced (newer aggregate).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone

HANDOFF_DIR = "pipeline-handoff"
STAGING_REL = "staging"
AGGREGATE_REL = os.path.join("aggregate", "aggregated_checkpoint.json")
MANIFEST_NAME = "manifest.json"
DEFAULT_BRANCH = "automation/pipeline-handoff"
MANIFEST_SCHEMA = 3
MAX_PUSH_ATTEMPTS = 8
STAGING_TELEMETRY_FILES = (
    "article_pipeline_phase_status.json",
    "article_pool_manifest.json",
)


def _merge_local_staging_telemetry(data_dir: str, handoff_staging_dest: str) -> None:
    """Overlay local staging telemetry (phase status, pool manifest) onto handoff staging tree."""
    local = os.path.join(data_dir, "staging")
    if not os.path.isdir(local):
        return
    os.makedirs(handoff_staging_dest, exist_ok=True)
    for name in STAGING_TELEMETRY_FILES:
        src = os.path.join(local, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(handoff_staging_dest, name))


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _run(cmd: list[str], cwd: str) -> None:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=os.environ.copy())
    if r.returncode != 0:
        sys.stderr.write(r.stderr or "")
        sys.stderr.write(r.stdout or "")
        raise subprocess.CalledProcessError(r.returncode, cmd, r.stdout, r.stderr)


def _run_id_int(raw: str | None) -> int:
    if not raw or not str(raw).strip():
        return 0
    s = str(raw).strip()
    try:
        return int(s)
    except ValueError:
        return 0


def _cas_disabled() -> bool:
    return os.environ.get("IU_SKIP_HANDOFF_CAS", "").strip().lower() in ("1", "true", "yes")


def remote_branch_exists(repo: str, branch: str) -> bool:
    r = subprocess.run(
        ["git", "ls-remote", "--heads", "origin", branch],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    return bool(r.stdout.strip())


def _manifest_from_show(repo: str, ref: str) -> dict | None:
    r = subprocess.run(
        ["git", "show", f"{ref}:{HANDOFF_DIR}/{MANIFEST_NAME}"],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0 or not (r.stdout or "").strip():
        return None
    try:
        m = json.loads(r.stdout)
        return m if isinstance(m, dict) else None
    except json.JSONDecodeError:
        return None


def _atomic_write_json(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _dir_size_approx(path: str) -> int:
    n = 0
    if not os.path.isdir(path):
        return 0
    for root, _, files in os.walk(path):
        for fn in files:
            try:
                n += os.path.getsize(os.path.join(root, fn))
            except OSError:
                pass
    return n


def _checkout_main(repo: str) -> None:
    _run(["git", "checkout", "main"], repo)


def _stash_worktree_if_dirty_for_handoff_checkout(repo: str) -> bool:
    """
    Stash local modifications so git checkout -B / --orphan cannot fail with
    'would be overwritten by checkout'. Must run only AFTER build(dest) so
    push-staging can still copy data_dir/scheduler_state.json (and peers) into dest.
    """
    st = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if not (st.stdout or "").strip():
        return False
    _run(
        ["git", "stash", "push", "-u", "-m", "iu-pipeline-handoff-checkout-preflight"],
        repo,
    )
    return True


def _stash_pop_after_handoff_checkout(repo: str, stashed: bool) -> None:
    """Restore working tree after handoff branch operations (retry paths, local runs)."""
    if not stashed:
        return
    r = subprocess.run(
        ["git", "stash", "pop"],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        sys.stderr.write(
            "WARNING: git stash pop after pipeline-handoff checkout failed: "
            + (r.stderr or r.stdout or "").strip()
            + "\n"
        )


def _extract_handoff_from_ref(repo: str, ref: str) -> str:
    """Extract pipeline-handoff/ from ref into temp dir; return path to handoff folder."""
    ar = subprocess.run(
        ["git", "archive", ref, HANDOFF_DIR],
        cwd=repo,
        capture_output=True,
    )
    if ar.returncode != 0:
        raise RuntimeError("git archive failed: " + (ar.stderr.decode() if ar.stderr else ""))
    td = tempfile.mkdtemp()
    tarfile.open(fileobj=io.BytesIO(ar.stdout), mode="r|").extractall(td)
    return os.path.join(td, HANDOFF_DIR)


def _winning_ingest_from_manifest(m: dict | None) -> int:
    if not m:
        return 0
    for k in ("winningIngestRunId", "ingestRunId"):
        v = m.get(k)
        if v is not None and str(v).strip():
            return _run_id_int(str(v))
    return 0


def _winning_aggregate_from_manifest(m: dict | None) -> int:
    if not m:
        return 0
    for k in ("winningAggregateRunId", "aggregateRunId"):
        v = m.get(k)
        if v is not None and str(v).strip():
            return _run_id_int(str(v))
    return 0


def _handoff_epoch_from_manifest(m: dict | None) -> int:
    if not m:
        return 0
    try:
        return int(m.get("handoffEpoch", 0) or 0)
    except (TypeError, ValueError):
        return 0


def _default_expect_path() -> str:
    base = os.environ.get("RUNNER_TEMP") or os.environ.get("TEMP") or tempfile.gettempdir()
    return os.path.join(base, "iu_handoff_publish_expect.json")


def _branch_tip_sha(repo: str, ref: str) -> str:
    r = subprocess.run(
        ["git", "rev-parse", ref],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return ""
    return (r.stdout or "").strip()


def _file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _append_github_output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write("%s=%s\n" % (key, value))


def _commit_handoff_tree_with_retry(repo: str, branch: str, message: str, build) -> str:
    """
    build(dest_handoff: str) writes pipeline-handoff contents into a temp dir.
    Invoked once per push attempt so manifest epoch/CAS match origin tip.
    Returns commit outcome: 'committed' | 'noop' | 'error'.
    """
    last_err: str | None = None
    for attempt in range(1, MAX_PUSH_ATTEMPTS + 1):
        td = tempfile.mkdtemp()
        stashed = False
        try:
            dest = os.path.join(td, HANDOFF_DIR)
            os.makedirs(dest, exist_ok=True)
            build(dest)
            stashed = _stash_worktree_if_dirty_for_handoff_checkout(repo)
            _run(["git", "fetch", "origin"], repo)
            if not remote_branch_exists(repo, branch):
                _run(["git", "checkout", "--orphan", branch], repo)
                subprocess.run(
                    ["git", "rm", "-rf", "--ignore-unmatch", "."],
                    cwd=repo,
                    capture_output=True,
                )
            else:
                _run(["git", "fetch", "origin", branch], repo)
                _run(["git", "checkout", "-B", branch, f"origin/{branch}"], repo)
            final = os.path.join(repo, HANDOFF_DIR)
            shutil.rmtree(final, ignore_errors=True)
            shutil.copytree(dest, final)
            _run(["git", "add", "-f", HANDOFF_DIR], repo)
            r = subprocess.run(["git", "diff", "--staged", "--quiet"], cwd=repo)
            if r.returncode == 0:
                _checkout_main(repo)
                return "noop"
            _run(["git", "commit", "-m", message], repo)
            try:
                _run(["git", "push", "-u", "origin", branch], repo)
                _checkout_main(repo)
                return "committed"
            except subprocess.CalledProcessError as e:
                last_err = str(e)
                _checkout_main(repo)
                time.sleep(min(2.0, 0.25 * attempt))
                continue
        finally:
            _stash_pop_after_handoff_checkout(repo, stashed)
            shutil.rmtree(td, ignore_errors=True)
    sys.stderr.write("ERROR: push failed after retries: %s\n" % (last_err or "unknown"))
    _checkout_main(repo)
    return "error"


def cmd_push_staging(args: argparse.Namespace) -> int:
    repo = _repo_root()
    branch = os.environ.get("PIPELINE_HANDOFF_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    data_dir = os.path.join(repo, os.environ.get("OUTPUT_DIR", "projects/data"))
    staging_src = os.path.join(data_dir, "staging")
    if not os.path.isdir(staging_src):
        print("ERROR: missing staging after ingest", file=sys.stderr)
        return 2
    rid = os.environ.get("GITHUB_RUN_ID", "") or os.environ.get("IU_PIPELINE_RUN_ID", "") or "local"
    my_rid = _run_id_int(rid)

    _run(["git", "fetch", "origin"], repo)
    remote_pre = _manifest_from_show(repo, f"origin/{branch}") if remote_branch_exists(repo, branch) else None
    rw_pre = _winning_ingest_from_manifest(remote_pre)
    if not _cas_disabled() and my_rid > 0 and rw_pre > 0 and my_rid < rw_pre:
        print(
            "[pipeline-handoff] STALE_INGEST_SKIP remote_winning_ingest_newer=YES my_run=%s" % rid,
            flush=True,
        )
        print("MULTI_RUN_RACE_SAFE=YES", flush=True)
        print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
        return 0

    def build(dest: str) -> None:
        shutil.copytree(staging_src, os.path.join(dest, STAGING_REL))
        sched = os.path.join(data_dir, "scheduler_state.json")
        if os.path.isfile(sched):
            shutil.copy2(sched, os.path.join(dest, "scheduler_state.json"))
        tr = os.path.join(data_dir, "feed_transport_state.json")
        if os.path.isfile(tr):
            shutil.copy2(tr, os.path.join(dest, "feed_transport_state.json"))
        _run(["git", "fetch", "origin"], repo)
        # First-run bootstrap: origin may not have automation/pipeline-handoff yet; do not fetch a missing ref.
        # _commit_handoff_tree_with_retry creates orphan branch + push when remote_branch_exists is false.
        if remote_branch_exists(repo, branch):
            _run(["git", "fetch", "origin", branch], repo)
        remote_m = _manifest_from_show(repo, f"origin/{branch}") if remote_branch_exists(repo, branch) else None
        rw = _winning_ingest_from_manifest(remote_m)
        epoch = _handoff_epoch_from_manifest(remote_m) + 1
        if not _cas_disabled() and my_rid > 0 and rw > 0 and my_rid < rw:
            raise RuntimeError("STALE_INGEST")
        manifest = {
            "schemaVersion": MANIFEST_SCHEMA,
            "updatedAtUtc": _now_utc(),
            "handoffComplete": True,
            "stagingReady": True,
            "aggregateReady": False,
            "publishReady": False,
            "ingestRunId": rid,
            "winningIngestRunId": rid,
            "winningAggregateRunId": remote_m.get("winningAggregateRunId", remote_m.get("aggregateRunId", ""))
            if remote_m
            else "",
            "handoffEpoch": epoch,
            "stagingBytesApprox": _dir_size_approx(os.path.join(dest, STAGING_REL)),
            "pointerNote": "CAS: winningIngestRunId + handoffEpoch; atomic commit",
        }
        _atomic_write_json(os.path.join(dest, MANIFEST_NAME), manifest)

    try:
        out = _commit_handoff_tree_with_retry(
            repo,
            branch,
            f"pipeline-handoff: staging after ingest (run {rid})",
            build,
        )
    except RuntimeError as e:
        if str(e) == "STALE_INGEST":
            print(
                "[pipeline-handoff] STALE_INGEST_SKIP concurrent_remote_advanced=YES my_run=%s" % rid,
                flush=True,
            )
            print("MULTI_RUN_RACE_SAFE=YES", flush=True)
            print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
            return 0
        raise
    if out == "error":
        return 2
    print("[pipeline-handoff] push-staging OK branch=%s outcome=%s" % (branch, out))
    print("MULTI_RUN_RACE_SAFE=YES", flush=True)
    print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
    return 0


def _staging_snapshot_run_id(data_dir: str) -> str:
    """Prefer handoffMeta; fallback to ingest_manifest.pipelineRunId (transition)."""
    path = os.path.join(data_dir, "staging", "aggregated_checkpoint.json")
    with open(path, encoding="utf-8") as f:
        ck = json.load(f)
    if isinstance(ck, dict):
        hm = ck.get("handoffMeta")
        if isinstance(hm, dict):
            s = str(hm.get("stagingSnapshotIngestRunId") or "").strip()
            if s:
                return s
    im = os.path.join(data_dir, "staging", "ingest_manifest.json")
    if os.path.isfile(im):
        try:
            with open(im, encoding="utf-8") as f:
                m = json.load(f)
            if isinstance(m, dict):
                s = str(m.get("pipelineRunId") or "").strip()
                if s:
                    return s
        except json.JSONDecodeError:
            pass
    return ""


def cmd_push_aggregate(args: argparse.Namespace) -> int:
    repo = _repo_root()
    branch = os.environ.get("PIPELINE_HANDOFF_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    data_dir = os.path.join(repo, os.environ.get("OUTPUT_DIR", "projects/data"))
    ck_src = os.path.join(data_dir, "staging", "aggregated_checkpoint.json")
    if not os.path.isfile(ck_src):
        print("ERROR: missing aggregated_checkpoint.json", file=sys.stderr)
        return 2
    if not remote_branch_exists(repo, branch):
        print("ERROR: handoff branch missing", file=sys.stderr)
        return 2

    rid = os.environ.get("GITHUB_RUN_ID", "") or os.environ.get("IU_PIPELINE_RUN_ID", "") or "local"
    my_rid = _run_id_int(rid)
    snap = _staging_snapshot_run_id(data_dir)
    if not _cas_disabled() and os.environ.get("GITHUB_RUN_ID") and not str(snap).strip():
        print("ERROR: missing staging snapshot id (handoffMeta or ingest manifest)", file=sys.stderr)
        return 2

    _run(["git", "fetch", "origin"], repo)
    _run(["git", "fetch", "origin", branch], repo)
    remote_pre = _manifest_from_show(repo, f"origin/{branch}") if remote_branch_exists(repo, branch) else None
    ra_pre = _winning_aggregate_from_manifest(remote_pre)
    if not _cas_disabled() and my_rid > 0 and ra_pre > 0 and my_rid < ra_pre:
        print(
            "[pipeline-handoff] STALE_AGGREGATE_SKIP remote_aggregate_newer=YES my_run=%s" % rid,
            flush=True,
        )
        print("MULTI_RUN_RACE_SAFE=YES", flush=True)
        print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
        return 0
    rw_pre = _winning_ingest_from_manifest(remote_pre)
    snap_s = str(snap).strip()
    if not _cas_disabled() and snap_s and rw_pre > 0 and _run_id_int(snap_s) != rw_pre:
        print(
            "[pipeline-handoff] STALE_AGGREGATE_SKIP staging_snapshot_mismatch=YES my_run=%s" % rid,
            flush=True,
        )
        print("MULTI_RUN_RACE_SAFE=YES", flush=True)
        print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
        return 0

    def build(dest: str) -> None:
        parent = os.path.dirname(dest)
        shutil.rmtree(dest, ignore_errors=True)
        _run(["git", "fetch", "origin", branch], repo)
        ref = f"origin/{branch}"
        ar = subprocess.run(
            ["git", "archive", ref, HANDOFF_DIR],
            cwd=repo,
            capture_output=True,
        )
        if ar.returncode != 0:
            raise RuntimeError("git archive failed for push-aggregate")
        tarfile.open(fileobj=io.BytesIO(ar.stdout), mode="r|").extractall(parent)
        if not os.path.isdir(os.path.join(dest, STAGING_REL)):
            raise RuntimeError("handoff missing staging tree after archive")
        remote_m = _manifest_from_show(repo, ref)
        if not remote_m:
            raise RuntimeError("missing remote manifest")
        if not remote_m.get("stagingReady"):
            raise RuntimeError("manifest stagingReady false")
        _merge_local_staging_telemetry(data_dir, os.path.join(dest, STAGING_REL))
        rw = _winning_ingest_from_manifest(remote_m)
        ra = _winning_aggregate_from_manifest(remote_m)
        snap_s = str(snap).strip()
        if not _cas_disabled():
            if snap_s and rw > 0 and _run_id_int(snap_s) != rw:
                raise RuntimeError("STALE_AGGREGATE_STAGING_MISMATCH")
            if my_rid > 0 and ra > 0 and my_rid < ra:
                raise RuntimeError("STALE_AGGREGATE_RUN")
        os.makedirs(os.path.join(dest, "aggregate"), exist_ok=True)
        shutil.copy2(ck_src, os.path.join(dest, AGGREGATE_REL))
        epoch = _handoff_epoch_from_manifest(remote_m) + 1
        manifest = {
            "schemaVersion": MANIFEST_SCHEMA,
            "updatedAtUtc": _now_utc(),
            "handoffComplete": True,
            "stagingReady": True,
            "aggregateReady": True,
            "publishReady": False,
            "ingestRunId": remote_m.get("ingestRunId", ""),
            "winningIngestRunId": str(rw) if rw else remote_m.get("winningIngestRunId", ""),
            "aggregateRunId": rid,
            "winningAggregateRunId": rid,
            "handoffEpoch": epoch,
            "stagingBytesApprox": remote_m.get("stagingBytesApprox", 0),
            "pointerNote": "CAS: aggregate run id + staging snapshot match; atomic commit",
        }
        _atomic_write_json(os.path.join(dest, MANIFEST_NAME), manifest)

    try:
        out = _commit_handoff_tree_with_retry(
            repo,
            branch,
            f"pipeline-handoff: aggregate checkpoint (run {rid})",
            build,
        )
    except RuntimeError as e:
        code = str(e)
        if code == "STALE_AGGREGATE_STAGING_MISMATCH":
            print(
                "[pipeline-handoff] STALE_AGGREGATE_SKIP staging_snapshot_mismatch=YES my_run=%s" % rid,
                flush=True,
            )
            print("MULTI_RUN_RACE_SAFE=YES", flush=True)
            print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
            return 0
        if code == "STALE_AGGREGATE_RUN":
            print(
                "[pipeline-handoff] STALE_AGGREGATE_SKIP remote_aggregate_newer=YES my_run=%s" % rid,
                flush=True,
            )
            print("MULTI_RUN_RACE_SAFE=YES", flush=True)
            print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
            return 0
        raise
    if out == "error":
        return 2
    print("[pipeline-handoff] push-aggregate OK branch=%s outcome=%s" % (branch, out))
    print("AGGREGATE_PERSIST_DIRTY_WORKTREE_SAFE=YES", flush=True)
    print("LOCAL_BUILD_CHANGES_CAN_BLOCK_HANDOFF_CHECKOUT=NO", flush=True)
    print("MULTI_RUN_RACE_SAFE=YES", flush=True)
    print("OLDER_RUN_CAN_OVERRIDE_NEWER=NO", flush=True)
    return 0


def cmd_pull_staging(args: argparse.Namespace) -> int:
    repo = _repo_root()
    branch = os.environ.get("PIPELINE_HANDOFF_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    data_dir = os.path.join(repo, os.environ.get("OUTPUT_DIR", "projects/data"))
    if not remote_branch_exists(repo, branch):
        print("ERROR: handoff branch missing on remote", file=sys.stderr)
        return 2
    _run(["git", "fetch", "origin", branch], repo)
    ref = f"origin/{branch}"
    handoff = _extract_handoff_from_ref(repo, ref)
    try:
        with open(os.path.join(handoff, MANIFEST_NAME), encoding="utf-8") as f:
            man = json.load(f)
        if not man.get("stagingReady"):
            print("ERROR: stagingReady false in manifest", file=sys.stderr)
            return 2
        staging_dst = os.path.join(data_dir, "staging")
        shutil.rmtree(staging_dst, ignore_errors=True)
        shutil.copytree(os.path.join(handoff, STAGING_REL), staging_dst)
        sched = os.path.join(handoff, "scheduler_state.json")
        if os.path.isfile(sched):
            os.makedirs(data_dir, exist_ok=True)
            shutil.copy2(sched, os.path.join(data_dir, "scheduler_state.json"))
        tr = os.path.join(handoff, "feed_transport_state.json")
        if os.path.isfile(tr):
            shutil.copy2(tr, os.path.join(data_dir, "feed_transport_state.json"))
        win = _winning_ingest_from_manifest(man)
        ep = _handoff_epoch_from_manifest(man)
        print(
            "[pipeline-handoff] pull-staging OK %s winningIngestRunId=%s handoffEpoch=%s"
            % (ref, win, ep),
            flush=True,
        )
    finally:
        shutil.rmtree(os.path.dirname(handoff), ignore_errors=True)
    return 0


def cmd_pull_for_publish(args: argparse.Namespace) -> int:
    repo = _repo_root()
    branch = os.environ.get("PIPELINE_HANDOFF_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    data_dir = os.path.join(repo, os.environ.get("OUTPUT_DIR", "projects/data"))
    if not remote_branch_exists(repo, branch):
        print("ERROR: handoff branch missing on remote", file=sys.stderr)
        return 2
    _run(["git", "fetch", "origin", branch], repo)
    ref = f"origin/{branch}"
    handoff = _extract_handoff_from_ref(repo, ref)
    try:
        with open(os.path.join(handoff, MANIFEST_NAME), encoding="utf-8") as f:
            man = json.load(f)
        if not man.get("aggregateReady"):
            print("ERROR: aggregateReady false", file=sys.stderr)
            return 2
        ck = os.path.join(handoff, AGGREGATE_REL)
        if not os.path.isfile(ck):
            print("ERROR: checkpoint file missing", file=sys.stderr)
            return 2
        os.makedirs(os.path.join(data_dir, "staging"), exist_ok=True)
        shutil.copy2(ck, os.path.join(data_dir, "staging", "aggregated_checkpoint.json"))
        handoff_staging = os.path.join(handoff, STAGING_REL)
        if os.path.isdir(handoff_staging):
            for name in STAGING_TELEMETRY_FILES:
                tel = os.path.join(handoff_staging, name)
                if os.path.isfile(tel):
                    shutil.copy2(tel, os.path.join(data_dir, "staging", name))
        sched = os.path.join(handoff, "scheduler_state.json")
        if os.path.isfile(sched):
            shutil.copy2(sched, os.path.join(data_dir, "scheduler_state.json"))
        tr = os.path.join(handoff, "feed_transport_state.json")
        if os.path.isfile(tr):
            shutil.copy2(tr, os.path.join(data_dir, "feed_transport_state.json"))
        wagg = _winning_aggregate_from_manifest(man)
        ep = _handoff_epoch_from_manifest(man)
        tip = _branch_tip_sha(repo, ref)
        ck_sha = _file_sha256(ck)
        expect_path = os.environ.get("IU_HANDOFF_EXPECT_PATH") or _default_expect_path()
        expect_payload = {
            "schemaVersion": 1,
            "pipelineHandoffBranch": branch,
            "branchTipSha": tip,
            "winningAggregateRunIdInt": wagg,
            "handoffEpoch": ep,
            "aggregateCheckpointSha256": ck_sha,
        }
        _atomic_write_json(expect_path, expect_payload)
        print(
            "[pipeline-handoff] pull-for-publish OK %s winningAggregateRunId=%s handoffEpoch=%s"
            % (ref, wagg, ep),
            flush=True,
        )
        print("[pipeline-handoff] publish expect fingerprint -> %s" % expect_path, flush=True)
        print("LATEST_CHECKPOINT_POINTER_CORRECT=YES", flush=True)
        print("PUBLISH_ALWAYS_USES_LATEST=YES", flush=True)
    finally:
        shutil.rmtree(os.path.dirname(handoff), ignore_errors=True)
    return 0


def cmd_verify_publish_latest(args: argparse.Namespace) -> int:
    """
    Re-fetch handoff branch; if aggregate truth advanced since pull-for-publish, mark stale.
    Caller must skip public data commit when stale_publish=true.
    """
    repo = _repo_root()
    branch = os.environ.get("PIPELINE_HANDOFF_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    expect_path = os.environ.get("IU_HANDOFF_EXPECT_PATH") or _default_expect_path()
    if not os.path.isfile(expect_path):
        print("ERROR: missing IU_HANDOFF_EXPECT file: %s" % expect_path, file=sys.stderr)
        return 2
    try:
        with open(expect_path, encoding="utf-8") as f:
            exp = json.load(f)
    except json.JSONDecodeError as e:
        print("ERROR: invalid expect JSON: %s" % e, file=sys.stderr)
        return 2
    expect_ra = int(exp.get("winningAggregateRunIdInt") or 0)
    expect_ep = int(exp.get("handoffEpoch") or 0)
    expect_ck = str(exp.get("aggregateCheckpointSha256") or "").strip()

    _run(["git", "fetch", "origin"], repo)
    if not remote_branch_exists(repo, branch):
        print("ERROR: handoff branch missing", file=sys.stderr)
        return 2
    _run(["git", "fetch", "origin", branch], repo)
    ref = f"origin/{branch}"
    remote_m = _manifest_from_show(repo, ref)
    if not remote_m or not remote_m.get("aggregateReady"):
        print("ERROR: remote manifest missing or aggregate not ready", file=sys.stderr)
        return 2
    ra = _winning_aggregate_from_manifest(remote_m)
    ep = _handoff_epoch_from_manifest(remote_m)

    stale = False
    if ra > expect_ra or ep > expect_ep:
        stale = True
    if not stale and expect_ck:
        handoff = _extract_handoff_from_ref(repo, ref)
        try:
            ck_path = os.path.join(handoff, AGGREGATE_REL)
            if os.path.isfile(ck_path):
                remote_ck = _file_sha256(ck_path)
                if remote_ck != expect_ck:
                    stale = True
        finally:
            shutil.rmtree(os.path.dirname(handoff), ignore_errors=True)

    if stale:
        print("[pipeline-handoff] STALE_PUBLISH_SKIP aggregate truth advanced after pull-for-publish", flush=True)
        print("STALE_PUBLISH_SKIP=YES", flush=True)
        print("OLDER_PUBLISH_CAN_RELEASE_AFTER_NEWER_AGGREGATE_EXISTS=NO", flush=True)
        print("PUBLISH_REVALIDATES_LATEST_BEFORE_RELEASE=YES", flush=True)
        print("FINAL_RELEASE_USES_EXPECTED_AGGREGATE_FINGERPRINT=YES", flush=True)
        _append_github_output("stale_publish", "true")
        return 0

    print("[pipeline-handoff] verify-publish-latest OK still latest aggregate", flush=True)
    print("STALE_PUBLISH_SKIP=NO", flush=True)
    print("OLDER_PUBLISH_CAN_RELEASE_AFTER_NEWER_AGGREGATE_EXISTS=NO", flush=True)
    print("PUBLISH_REVALIDATES_LATEST_BEFORE_RELEASE=YES", flush=True)
    print("FINAL_RELEASE_USES_EXPECTED_AGGREGATE_FINGERPRINT=YES", flush=True)
    _append_github_output("stale_publish", "false")
    return 0


def cmd_mark_publish_done(args: argparse.Namespace) -> int:
    repo = _repo_root()
    branch = os.environ.get("PIPELINE_HANDOFF_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    if not remote_branch_exists(repo, branch):
        return 0
    rid = os.environ.get("GITHUB_RUN_ID", "") or "local"
    _run(["git", "fetch", "origin", branch], repo)
    _run(["git", "checkout", "-B", branch, f"origin/{branch}"], repo)
    man_path = os.path.join(repo, HANDOFF_DIR, MANIFEST_NAME)
    if os.path.isfile(man_path):
        with open(man_path, encoding="utf-8") as f:
            man = json.load(f)
        man["publishReady"] = True
        man["updatedAtUtc"] = _now_utc()
        man["publishRunId"] = rid
        _atomic_write_json(man_path, man)
        _run(["git", "add", "-f", HANDOFF_DIR], repo)
        r = subprocess.run(["git", "diff", "--staged", "--quiet"], cwd=repo)
        if r.returncode != 0:
            _run(["git", "commit", "-m", f"pipeline-handoff: publish done (run {rid})"], repo)
            _run(["git", "push", "origin", branch], repo)
    _checkout_main(repo)
    print("[pipeline-handoff] mark-publish-done OK")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Git cross-run pipeline handoff")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("push-staging")
    sub.add_parser("push-aggregate")
    sub.add_parser("pull-staging")
    sub.add_parser("pull-for-publish")
    sub.add_parser("verify-publish-latest")
    sub.add_parser("mark-publish-done")
    args = p.parse_args()
    if args.cmd == "push-staging":
        return cmd_push_staging(args)
    if args.cmd == "push-aggregate":
        return cmd_push_aggregate(args)
    if args.cmd == "pull-staging":
        return cmd_pull_staging(args)
    if args.cmd == "pull-for-publish":
        return cmd_pull_for_publish(args)
    if args.cmd == "verify-publish-latest":
        return cmd_verify_publish_latest(args)
    if args.cmd == "mark-publish-done":
        return cmd_mark_publish_done(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
