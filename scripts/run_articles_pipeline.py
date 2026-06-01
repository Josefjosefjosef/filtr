#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LEGACY — not used in production CI. V3: scripts/build_articles.py via update-articles.yml.
Entrypoint pro spuštění articles pipeline (wrapper kolem build_articles_v2.py).
"""

import sys
import os

# Přidat scripts/ do path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_articles_v2 import main

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
