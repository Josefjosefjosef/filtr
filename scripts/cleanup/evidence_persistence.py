# -*- coding: utf-8 -*-
"""
GATE 2-3: Crash-safe evidence persistence. Session + per-iteration folders in %TEMP%.
Atomic write: temp file -> fsync -> rename -> journal append.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List

from .evidence_contract import PER_ITERATION_REQUIRED_FILES, REQUIRED_EVIDENCE_CONTRACT_V1

TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_BASE = TEMP_BASE / "reports" / "cleanup-engine"


def _session_dir(session_id: str) -> Path:
    return ENGINE_BASE / f"session-{session_id}"


def _iteration_dir(session_id: str, iteration_number: int) -> Path:
    return _session_dir(session_id) / f"iteration-{iteration_number:03d}"


def _atomic_write(path: Path, data: Dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    if hasattr(os, "fdatasync"):
        with open(tmp, "rb") as f:
            os.fdatasync(f.fileno())
    if path.exists():
        path.unlink()
    tmp.rename(path)


def _journal_append(session_id: str, event: Dict[str, Any]) -> None:
    d = _session_dir(session_id)
    d.mkdir(parents=True, exist_ok=True)
    journal = d / "journal.ndjson"
    with open(journal, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
        if hasattr(f, "flush"):
            f.flush()
            if hasattr(os, "fdatasync"):
                os.fdatasync(f.fileno())


WRITE_ORDER_CONTRACT = [
    "session_manifest_open",
    "candidate_packet",
    "pre_check",
    "diff_isolation",
    "proof_scope",
    "guard_chain",
    "hard_proof_raw",
    "metric_delta",
    "closure",
    "redo_block",
    "checkpoint",
    "final_forensic_record",
    "journal_append_committed",
]

ATOMIC_WRITE_STRATEGY = "write_to_tmp_same_dir_fsync_rename"
RESUME_AFTER_CRASH_RULES = "scan_journal_for_last_committed_iteration; if checkpoint.json exists for iteration N, iteration N committed; else resume from last completed step or mark iteration incomplete"
CORRUPTION_HANDLING = "do_not_overwrite_existing_final_forensic_record; if tmp exists and final missing, rename tmp to final only if content valid json"


def ensure_session(session_id: str) -> Path:
    d = _session_dir(session_id)
    d.mkdir(parents=True, exist_ok=True)
    manifest = d / "manifest.json"
    if not manifest.exists():
        _atomic_write(manifest, {
            "session_id": session_id,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "write_order_contract": WRITE_ORDER_CONTRACT,
        })
    return d


def write_iteration_evidence_bundle(
    session_id: str,
    iteration_number: int,
    candidate_packet: Dict[str, Any],
    pre_check: Dict[str, Any],
    diff_isolation: Dict[str, Any],
    proof_scope: Dict[str, Any],
    guard_chain: Dict[str, Any],
    hard_proof_raw: Dict[str, Any],
    metric_delta: Dict[str, Any],
    closure: Dict[str, Any],
    redo_block: Dict[str, Any],
    checkpoint: Dict[str, Any],
    final_forensic_record: Dict[str, Any],
    dry_run: bool = False,
) -> List[Path]:
    """Write full evidence bundle in contract order. Returns list of created paths."""
    ensure_session(session_id)
    it_dir = _iteration_dir(session_id, iteration_number)
    it_dir.mkdir(parents=True, exist_ok=True)
    created: List[Path] = []

    def write(name: str, data: Dict[str, Any]) -> None:
        p = it_dir / name
        _atomic_write(p, data)
        created.append(p)

    write("candidate_packet.json", candidate_packet)
    write("pre_check.json", pre_check)
    write("diff_isolation.json", diff_isolation)
    write("proof_scope.json", proof_scope)
    write("guard_chain.json", guard_chain)
    write("hard_proof_raw.json", hard_proof_raw)
    write("metric_delta.json", metric_delta)
    write("closure.json", closure)
    write("redo_block.json", redo_block)
    write("checkpoint.json", checkpoint)
    write("final_forensic_record.json", final_forensic_record)

    _journal_append(session_id, {
        "event": "iteration_committed",
        "iteration_number": iteration_number,
        "dry_run": dry_run,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    return created


def folder_tree(session_id: str) -> str:
    """Return required folder structure description."""
    return (
        "%TEMP%\\filtr_readiness\\reports\\cleanup-engine\n"
        "session-<id>\n"
        "  manifest.json\n"
        "  journal.ndjson\n"
        "  iteration-001\n"
        "    candidate_packet.json\n"
        "    pre_check.json\n"
        "    diff_isolation.json\n"
        "    proof_scope.json\n"
        "    guard_chain.json\n"
        "    hard_proof_raw.json\n"
        "    metric_delta.json\n"
        "    closure.json\n"
        "    redo_block.json\n"
        "    checkpoint.json\n"
        "    final_forensic_record.json\n"
        "  iteration-002\n"
        "    ...\n"
    )
