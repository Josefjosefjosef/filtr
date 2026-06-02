#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""servis.idnes.cz robots: explicit Allow /rss.aspx must permit RSS fetch."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_crawler import (  # noqa: E402
    IU_USER_AGENT,
    _robots_can_fetch,
    robots_allowed_for_url,
)

SERVIS_ROBOTS = """User-agent: *
Disallow: /
Allow: /rss.aspx
"""


class IdnesRobotsTest(unittest.TestCase):
    def test_servis_idnes_rss_allowed(self):
        url = "https://servis.idnes.cz/rss.aspx?c=zpravodaj"
        self.assertTrue(_robots_can_fetch(SERVIS_ROBOTS, IU_USER_AGENT, url))

    def test_servis_idnes_non_rss_blocked(self):
        url = "https://servis.idnes.cz/other/blocked-path"
        self.assertFalse(_robots_can_fetch(SERVIS_ROBOTS, IU_USER_AGENT, url))

    def test_robots_allowed_for_url_cached(self):
        out = tempfile.mkdtemp()
        cache_path = os.path.join(out, "robots_cache.json")
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "hosts": {
                        "servis.idnes.cz": {
                            "fetched_at": 9999999999,
                            "body": SERVIS_ROBOTS,
                            "fetch_ok": True,
                        }
                    }
                },
                f,
            )
        allowed, reason = robots_allowed_for_url(
            "https://servis.idnes.cz/rss.aspx?c=zpravodaj", out, None
        )
        self.assertTrue(allowed)
        self.assertEqual(reason, "allowed")

        blocked, reason2 = robots_allowed_for_url(
            "https://servis.idnes.cz/data.aspx", out, None
        )
        self.assertFalse(blocked)
        self.assertEqual(reason2, "disallowed_by_robots")


if __name__ == "__main__":
    unittest.main()
