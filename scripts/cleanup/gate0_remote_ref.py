# -*- coding: utf-8 -*-
"""
GATE 0: Remote ref check. Before pull, verify remote ref exists.
If ref does not exist: do not treat as engine failure; either push branch or skip pull with explicit proof.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Tuple

ROOT = Path(__file__).resolve().parent.parent.parent


def remote_ref_exists(branch: str) -> bool:
    """True iff origin/branch exists (ls-remote)."""
    try:
        r = subprocess.run(
            ["git", "ls-remote", "--heads", "origin", branch],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:
        return False


def pull_ff_only_if_ref_exists(branch: str) -> Tuple[bool, str]:
    """
    If origin/branch exists: run git pull --ff-only origin <branch>, return (True, stdout).
    If not: skip pull, return (False, "SKIP_PULL_REMOTE_REF_MISSING").
    """
    if not remote_ref_exists(branch):
        return (False, "SKIP_PULL_REMOTE_REF_MISSING")
    try:
        r = subprocess.run(
            ["git", "pull", "--ff-only", "origin", branch],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if r.returncode != 0:
            return (False, (r.stderr or r.stdout or "pull_failed").strip())
        return (True, (r.stdout or "").strip())
    except Exception as e:
        return (False, "pull_exception: " + str(e))
