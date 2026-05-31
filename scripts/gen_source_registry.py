#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-shot generator for projects/data/source_registry.json — run: py -3 scripts/gen_source_registry.py"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "projects", "data", "source_registry.json")

SLOTS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38]


def base(
    eid,
    label,
    domain,
    etype,
    sec_pri,
    sec_sec,
    interval,
    weight,
    url,
    cooldown=None,
    slot=None,
    topic=None,
):
    """topic = RSS topic field (aktualne, sport, cestovani, …). Defaults from section_primary."""
    if topic is None:
        m = {
            "zpravy": "aktualne",
            "sport": "sport",
            "finance": "finance",
            "zdravi": "zdravi",
            "cestovani": "cestovani",
            "hry": "hry",
            "kultura": "kultura",
            "veda": "veda",
            "vzdelavani": "vzdelavani",
        }
        topic = m.get(sec_pri, "aktualne")
    cd = cooldown
    if cd is None:
        if domain in ("novinky.cz", "idnes.cz", "ct24.ceskatelevize.cz", "ceskatelevize.cz", "seznamzpravy.cz"):
            cd = 20
        elif domain == "hn.cz":
            cd = 25
        elif domain in ("echoserver.cz",):
            cd = 15
        else:
            cd = 12
    so = slot if slot is not None else SLOTS[hash(eid) % len(SLOTS)]
    return {
        "id": eid,
        "label": label,
        "domain": domain,
        "entry_type": etype,
        "section_primary": sec_pri,
        "section_secondary": list(sec_sec) if sec_sec else [],
        "interval_min": interval,
        "display_weight": weight,
        "active": True,
        "blocked": False,
        "official_only": True,
        "fetch_mode": "rss_or_official_rubric_only",
        "per_domain_cooldown_min": cd,
        "slot_offset_min": so,
        "max_items_per_fetch": 40,
        "last_fetch_at": None,
        "last_success_at": None,
        "error_streak": 0,
        "backoff_multiplier": 1.0,
        "feed_url": url,
        "topic": topic,
    }


ENTRIES = []

# --- Blocked (explicit) ---
ENTRIES.append(
    {
        "id": "blocked_hedvabnastezka",
        "label": "BLOCKED hedvabnastezka.cz",
        "domain": "hedvabnastezka.cz",
        "entry_type": "legacy_source",
        "section_primary": "cestovani",
        "section_secondary": [],
        "interval_min": 9999,
        "display_weight": 0.0,
        "active": False,
        "blocked": True,
        "official_only": False,
        "fetch_mode": "blocked",
        "per_domain_cooldown_min": 9999,
        "slot_offset_min": 0,
        "max_items_per_fetch": 0,
        "last_fetch_at": None,
        "last_success_at": None,
        "error_streak": 0,
        "backoff_multiplier": 1.0,
        "feed_url": "https://www.hedvabnastezka.cz/rss/",
        "topic": "cestovani",
        "reason": "hard_blocked_source",
    }
)
ENTRIES.append(
    {
        "id": "blocked_hedvabnastezka_www",
        "label": "BLOCKED www.hedvabnastezka.cz",
        "domain": "www.hedvabnastezka.cz",
        "entry_type": "legacy_source",
        "section_primary": "cestovani",
        "section_secondary": [],
        "interval_min": 9999,
        "display_weight": 0.0,
        "active": False,
        "blocked": True,
        "official_only": False,
        "fetch_mode": "blocked",
        "per_domain_cooldown_min": 9999,
        "slot_offset_min": 0,
        "max_items_per_fetch": 0,
        "last_fetch_at": None,
        "last_success_at": None,
        "error_streak": 0,
        "backoff_multiplier": 1.0,
        "feed_url": "https://www.hedvabnastezka.cz/rss/",
        "topic": "cestovani",
        "reason": "hard_blocked_source",
    }
)

# 5.1 ZPRÁVY
# ČTK: www.ceskenoviny.cz/rss/ vrací HTML místo RSS (2026-05) — zdroj deaktivován, ne parser bug.
_zpr_ctk = base("zpr_ctk", "ČTK / ČeskéNoviny", "ceskenoviny.cz", "rss", "zpravy", [], 15, 1.30, "https://www.ceskenoviny.cz/rss/")
_zpr_ctk["active"] = False
_zpr_ctk["fetch_mode"] = "feed_unavailable"
_zpr_ctk["reason"] = "feed_returns_html_not_rss"
ENTRIES.append(_zpr_ctk)
ENTRIES.append(base("zpr_ct24_domaci", "ČT24 / Domácí", "ct24.ceskatelevize.cz", "rubric", "zpravy", [], 25, 1.20, "https://ct24.ceskatelevize.cz/rss"))
ENTRIES.append(base("zpr_ct24_svet", "ČT24 / Svět", "ct24.ceskatelevize.cz", "rubric", "zpravy", [], 25, 1.20, "https://ct24.ceskatelevize.cz/rss", slot=22))
ENTRIES.append(base("zpr_seznam_domaci", "Seznam Zprávy / Domácí", "seznamzpravy.cz", "rubric", "zpravy", [], 25, 1.15, "https://www.seznamzpravy.cz/rss/domaci"))
ENTRIES.append(base("zpr_novinky_domaci", "Novinky / Domácí", "novinky.cz", "rubric", "zpravy", [], 25, 1.15, "https://www.novinky.cz/rss/domaci", slot=4))
ENTRIES.append(base("zpr_novinky_zahranicni", "Novinky / Zahraniční", "novinky.cz", "rubric", "zpravy", [], 25, 1.15, "https://www.novinky.cz/rss/zahranicni", slot=18))
ENTRIES.append(base("zpr_idnes_zpravy", "iDNES / Zprávy", "idnes.cz", "rubric", "zpravy", [], 25, 1.10, "https://servis.idnes.cz/rss.aspx?c=zpravodaj", slot=8))
ENTRIES.append(base("zpr_denik", "Deník", "denik.cz", "rubric", "zpravy", [], 40, 0.95, "https://www.denik.cz/rss/zpravy.html"))
ENTRIES.append(base("zpr_aktualne", "Aktuálně", "aktualne.cz", "rss", "zpravy", [], 40, 0.95, "https://www.aktualne.cz/rss/"))
ENTRIES.append(base("zpr_hlidacipes", "HlídacíPes", "hlidacipes.org", "rss", "zpravy", [], 90, 0.80, "https://hlidacipes.org/feed/"))
ENTRIES.append(base("zpr_kverulant", "Kverulant", "kverulant.org", "rss", "zpravy", [], 90, 0.75, "https://www.kverulant.org/feed/"))
ENTRIES.append(base("zpr_ceskajustice", "Česká justice", "ceska-justice.cz", "rss", "zpravy", [], 90, 0.75, "https://www.ceska-justice.cz/feed/"))
ENTRIES.append(base("zpr_tydenikpolicie", "Týdeník Policie", "tydenikpolicie.cz", "rss", "zpravy", [], 90, 0.75, "https://www.tydenikpolicie.cz/feed/"))

# 5.2 SPORT
ENTRIES.append(base("spt_ctsport", "ČT sport", "ceskatelevize.cz", "rss", "sport", [], 25, 1.20, "https://sport.ceskatelevize.cz/rss", cooldown=20))
ENTRIES.append(base("spt_sportcz", "Sport.cz", "sport.cz", "rss", "sport", [], 25, 1.15, "https://www.sport.cz/rss"))
ENTRIES.append(base("spt_isport", "iSport", "isport.blesk.cz", "rss", "sport", [], 40, 1.05, "https://isport.blesk.cz/rss"))
ENTRIES.append(base("spt_idnes", "iDNES / Sport", "idnes.cz", "rubric", "sport", [], 40, 1.00, "https://servis.idnes.cz/rss.aspx?c=sport", cooldown=20, slot=12))
ENTRIES.append(base("spt_tenisportal", "TenisPortal", "tenisportal.cz", "rss", "sport", [], 180, 0.70, "https://www.tenisportal.cz/rss"))
ENTRIES.append(base("spt_mmamag", "MMAMAG", "mmamag.cz", "rss", "sport", [], 90, 0.80, "https://www.mmamag.cz/feed/"))
ENTRIES.append(base("spt_crzpravy_sport", "ČR Zprávy / Sport", "crzpravy.cz", "rss", "sport", [], 90, 0.75, "https://www.crzpravy.cz/rss/sport/"))

# 5.3 FINANCE
ENTRIES.append(base("fin_sz_byznys", "Seznam Zprávy / Byznys", "seznamzpravy.cz", "rubric", "finance", [], 25, 1.15, "https://www.seznamzpravy.cz/rss/byznys", slot=6))
ENTRIES.append(base("fin_novinky_ekonomika", "Novinky / Ekonomika", "novinky.cz", "rubric", "finance", [], 25, 1.10, "https://www.novinky.cz/rss/ekonomika", slot=14))
ENTRIES.append(base("fin_idnes_ekonomika", "iDNES / Ekonomika", "idnes.cz", "rubric", "finance", [], 25, 1.05, "https://servis.idnes.cz/rss.aspx?c=ekonomika", slot=26))
ENTRIES.append(base("fin_hn", "HN / Ekonomika", "hn.cz", "rss", "finance", [], 40, 1.00, "https://hn.cz/?m=rss", cooldown=25))
ENTRIES.append(base("fin_e15", "E15", "e15.cz", "rss", "finance", [], 40, 1.00, "https://www.e15.cz/rss"))
ENTRIES.append(base("fin_ekonom", "Ekonom (HN)", "ekonom.cz", "rss", "finance", [], 40, 0.95, "https://ekonom.cz/?p=400000_rss"))
ENTRIES.append(base("fin_ekonomickydenik", "Ekonomický deník", "ekonomickydenik.cz", "rss", "finance", [], 90, 0.85, "https://www.ekonomickydenik.cz/feed/"))
ENTRIES.append(base("fin_penize", "Peníze.cz", "penize.cz", "rss", "finance", [], 90, 0.85, "https://www.penize.cz/rss"))
ENTRIES.append(base("fin_epenize", "ePeníze", "epenize.eu", "rss", "finance", [], 90, 0.80, "https://www.epenize.eu/rss"))
ENTRIES.append(base("fin_faei", "FAEI", "faei.cz", "rss", "finance", [], 90, 0.80, "https://www.faei.cz/feed/"))

# 5.4 ZDRAVÍ
ENTRIES.append(base("zdr_zdravezpravy", "ZdravéZprávy", "zdravezpravy.cz", "rss", "zdravi", [], 40, 1.05, "https://www.zdravezpravy.cz/feed/"))
ENTRIES.append(base("zdr_zdravotnickydenik", "Zdravotnický deník", "zdravotnickydenik.cz", "rss", "zdravi", [], 40, 1.05, "https://www.zdravotnickydenik.cz/feed/"))
ENTRIES.append(base("zdr_plnezdravi", "Plné zdraví", "plnezdravi.cz", "rss", "zdravi", [], 90, 0.85, "https://www.plnezdravi.cz/feed/"))
ENTRIES.append(base("zdr_zdrave", "Zdravě.cz", "zdrave.cz", "rss", "zdravi", [], 180, 0.75, "https://www.zdrave.cz/rss/"))
ENTRIES.append(base("zdr_prozeny_zdravi", "ProŽeny / Zdraví", "prozeny.cz", "rubric", "zdravi", [], 180, 0.70, "https://www.prozeny.cz/rss/zdravi"))
ENTRIES.append(base("zdr_betterlife", "BetterLife", "betterlife.cz", "rss", "zdravi", [], 180, 0.65, "https://www.betterlife.cz/feed/"))

# 5.5 CESTOVÁNÍ
ENTRIES.append(base("ces_novinky_cestovani", "Novinky / Cestování", "novinky.cz", "rubric", "cestovani", [], 40, 1.00, "https://www.novinky.cz/rss/cestovani", cooldown=20))
ENTRIES.append(base("ces_svetcestovatele", "SvětCestovatele", "svetcestovatele.cz", "rss", "cestovani", [], 90, 0.90, "https://www.svetcestovatele.cz/feed/"))
ENTRIES.append(base("ces_cestujlevne", "Cestujlevně", "cestujlevne.com", "rss", "cestovani", [], 90, 0.90, "https://www.cestujlevne.com/feed/"))
ENTRIES.append(base("ces_pelipecky", "Pelipecky", "pelipecky.cz", "rss", "cestovani", [], 180, 0.75, "https://www.pelipecky.cz/feed/"))
ENTRIES.append(base("ces_travelbible", "TravelBible", "travelbible.cz", "rss", "cestovani", [], 180, 0.75, "https://travelbible.cz/feed/"))

# 5.6 HRY (games.cz/rss mrtvé → iDNES/Novinky rubriky; zing kanonický feed)
ENTRIES.append(base("hry_novinky", "Novinky / Hry", "novinky.cz", "rubric", "hry", [], 25, 1.05, "https://www.novinky.cz/rss/hry", slot=20))
ENTRIES.append(base("hry_indian", "Indian", "indian-tv.cz", "rss", "hry", [], 90, 0.90, "https://indian-tv.cz/feed/"))
ENTRIES.append(base("hry_vortex", "Vortex", "vortex.cz", "rss", "hry", [], 90, 0.90, "https://www.vortex.cz/feed/"))
ENTRIES.append(base("hry_zing", "Zing", "zing.cz", "rss", "hry", [], 90, 0.85, "https://zing.cz/rss/all"))
ENTRIES.append(base("hry_sector", "Sector", "sector.sk", "rss", "hry", [], 180, 0.75, "https://sector.sk/feed/"))
ENTRIES.append(base("hry_nedd", "Nedd", "nedd.cz", "rss", "hry", [], 180, 0.70, "https://www.nedd.cz/feed/"))

# 5.7 KULTURA
ENTRIES.append(base("kul_ctart", "ČT art", "ct24.ceskatelevize.cz", "rubric", "kultura", [], 40, 1.05, "https://ct24.ceskatelevize.cz/rss/kultura", cooldown=20))
ENTRIES.append(base("kul_kinobox", "Kinobox", "kinobox.cz", "rss", "kultura", [], 90, 0.95, "https://www.kinobox.cz/api/rss"))
ENTRIES.append(base("kul_vtelce", "vTelce", "vtelce.cz", "rss", "kultura", [], 180, 0.75, "https://www.vtelce.cz/feed/"))
ENTRIES.append(base("kul_vipzivot", "VIPživot", "vipzivot.cz", "rss", "kultura", [], 180, 0.70, "https://www.vipzivot.cz/feed/"))
ENTRIES.append(base("kul_vlasta", "Vlasta", "vlasta.cz", "rss", "kultura", [], 180, 0.70, "https://www.vlasta.cz/feed/"))

# 5.8 VĚDA
ENTRIES.append(base("ved_ct24_veda", "ČT24 / Věda", "ct24.ceskatelevize.cz", "rubric", "veda", [], 25, 1.10, "https://ct24.ceskatelevize.cz/rss/veda", slot=10))
ENTRIES.append(base("ved_novinky", "Novinky / Věda a škola", "novinky.cz", "rubric", "veda", [], 25, 1.05, "https://www.novinky.cz/rss/veda", slot=18))
ENTRIES.append(base("ved_technet", "iDNES / Technet", "idnes.cz", "rubric", "veda", [], 40, 1.00, "https://servis.idnes.cz/rss.aspx?c=technet", cooldown=20))
ENTRIES.append(base("ved_vtm", "VTM", "vtm.zive.cz", "rss", "veda", [], 40, 0.95, "https://vtm.zive.cz/rss"))

# 5.9 VZDĚLÁVÁNÍ
ENTRIES.append(base("vzd_seznam", "Seznam Zprávy / Vzdělávání", "seznamzpravy.cz", "rubric", "vzdelavani", [], 25, 1.05, "https://www.seznamzpravy.cz/rss/vzdelavani", slot=12))
ENTRIES.append(base("vzd_novinky_skola", "Novinky / Škola", "novinky.cz", "rubric", "vzdelavani", [], 25, 1.00, "https://www.novinky.cz/rss/skola", slot=24))
ENTRIES.append(base("vzd_nespechej", "Nespěchej", "nespechej.cz", "rss", "vzdelavani", [], 180, 0.75, "https://www.nespechej.cz/feed/"))
ENTRIES.append(base("vzd_betterlife", "BetterLife (edu)", "betterlife.cz", "rss", "vzdelavani", [], 180, 0.65, "https://www.betterlife.cz/feed/", slot=36))


def main():
    payload = {"version": "2.0.0", "tick_interval_min": 2, "sources_per_tick": {"min": 2, "max": 3, "three_source_tick_fraction": 0.62}, "entries": ENTRIES}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("WROTE", OUT, "entries=", len(ENTRIES))


if __name__ == "__main__":
    main()
