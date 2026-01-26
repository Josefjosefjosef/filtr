#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Health Reporter - generování health reportů po každém běhu
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List


class HealthReporter:
    """Generátor health reportů."""
    
    def __init__(self, health_dir: Path):
        self.health_dir = Path(health_dir)
        self.health_dir.mkdir(parents=True, exist_ok=True)
    
    def generate_report(self, 
                       timestamp: str,
                       items_count: int,
                       videos_count: int,
                       sources_ok: List[str],
                       sources_fail: List[str],
                       sources_quarantined: List[str],
                       duration_seconds: float,
                       pipeline_version: str = "2.0.0",
                       canary_pass: bool = False,
                       canary_reason: str = "") -> Dict[str, Any]:
        """
        Generování health reportu.
        """
        report = {
            "timestamp": timestamp,
            "pipelineVersion": pipeline_version,
            "totals": {
                "items": items_count,
                "videos": videos_count,
                "articles": items_count - videos_count,
            },
            "sources": {
                "ok": len(sources_ok),
                "fail": len(sources_fail),
                "quarantined": len(sources_quarantined),
                "ok_list": sources_ok,
                "fail_list": sources_fail,
                "quarantined_list": sources_quarantined,
            },
            "performance": {
                "durationSeconds": round(duration_seconds, 2),
            },
            "canary": {
                "pass": canary_pass,
                "reason": canary_reason,
            },
        }
        
        return report
    
    def save_report(self, report: Dict[str, Any], format: str = "json") -> Path:
        """
        Uložení reportu do souboru.
        format: "json" nebo "md"
        """
        timestamp = report["timestamp"]
        timestamp_safe = timestamp.replace(":", "-").replace("+", "-").replace("Z", "")
        
        if format == "json":
            path = self.health_dir / f"health-{timestamp_safe}.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
        elif format == "md":
            path = self.health_dir / f"health-{timestamp_safe}.md"
            with open(path, "w", encoding="utf-8") as f:
                self._write_markdown(report, f)
        else:
            raise ValueError(f"Unknown format: {format}")
        
        # Aktualizace latest
        latest_path = self.health_dir / "health.json"
        with open(latest_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        return path
    
    def _write_markdown(self, report: Dict[str, Any], f):
        """Zápis markdown formátu."""
        f.write(f"# Health Report\n\n")
        f.write(f"**Timestamp:** {report['timestamp']}\n")
        f.write(f"**Pipeline Version:** {report['pipelineVersion']}\n\n")
        
        f.write(f"## Totals\n\n")
        totals = report["totals"]
        f.write(f"- Items: {totals['items']}\n")
        f.write(f"- Articles: {totals['articles']}\n")
        f.write(f"- Videos: {totals['videos']}\n\n")
        
        f.write(f"## Sources\n\n")
        sources = report["sources"]
        f.write(f"- OK: {sources['ok']}\n")
        f.write(f"- Fail: {sources['fail']}\n")
        f.write(f"- Quarantined: {sources['quarantined']}\n\n")
        
        if sources["fail_list"]:
            f.write(f"### Failed Sources\n\n")
            for src in sources["fail_list"]:
                f.write(f"- {src}\n")
            f.write("\n")
        
        if sources["quarantined_list"]:
            f.write(f"### Quarantined Sources\n\n")
            for src in sources["quarantined_list"]:
                f.write(f"- {src}\n")
            f.write("\n")
        
        f.write(f"## Performance\n\n")
        perf = report["performance"]
        f.write(f"- Duration: {perf['durationSeconds']}s\n\n")
        
        f.write(f"## Canary\n\n")
        canary = report["canary"]
        f.write(f"- Pass: {canary['pass']}\n")
        if canary["reason"]:
            f.write(f"- Reason: {canary['reason']}\n")
