#!/usr/bin/env python3
"""
Grouping Audit Script
Analyzuje reálná data z articles.json a simuluje topic grouping
pro detekci false positives a duplicitních zdrojů
"""

import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Set, Tuple

def normalize_title_for_key(title: str) -> str:
    """Normalizuje title pro výpočet klíče tématu"""
    if not title or not isinstance(title, str):
        return ""
    
    # Lowercase
    normalized = title.lower()
    
    # Odstranění diakritiky
    replacements = {
        'á': 'a', 'à': 'a', 'ä': 'a',
        'é': 'e', 'è': 'e', 'ě': 'e',
        'í': 'i', 'ì': 'i',
        'ó': 'o', 'ò': 'o', 'ö': 'o',
        'ú': 'u', 'ù': 'u', 'ů': 'u', 'ü': 'u',
        'ý': 'y',
        'č': 'c', 'ď': 'd', 'ň': 'n', 'ř': 'r',
        'š': 's', 'ť': 't', 'ž': 'z',
    }
    for old, new in replacements.items():
        normalized = normalized.replace(old, new)
    
    # Odstranění interpunkce a speciálních znaků
    normalized = re.sub(r'[^\w\s]', ' ', normalized)
    # Odstranění čísel (samostatné)
    normalized = re.sub(r'\b\d+\b', ' ', normalized)
    # Redukce whitespace
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    
    # Odstranění "měkkých" stop slov
    soft_stop_words = {"video", "zive", "aktualne", "live", "breaking"}
    words = normalized.split()
    filtered = [w for w in words if len(w) > 2 and w not in soft_stop_words]
    
    return " ".join(filtered)

def compute_topic_key(article: Dict) -> str:
    """Vypočítá klíč tématu z článku"""
    if not article:
        return None
    
    title = article.get("title") or article.get("headline") or article.get("name") or ""
    normalized_title = normalize_title_for_key(title)
    
    if len(normalized_title) < 10:
        topic = (article.get("topic") or "").lower().strip()
        section = (article.get("section") or "").lower().strip()
        if topic or section:
            return f"{topic}||{section}"
    
    return normalized_title or None

def merge_sources_dedup(sources_list: List[List[Dict]]) -> List[Dict]:
    """Sloučí a deduplikuje sources z více článků"""
    seen = set()
    merged = []
    
    for sources in sources_list:
        if not isinstance(sources, list):
            continue
        
        for source in sources:
            if not source or not isinstance(source, dict):
                continue
            
            name = str(source.get("name") or source.get("title") or "").strip()
            url = str(source.get("url") or source.get("link") or "").strip()
            
            if not name or not url:
                continue
            
            key = f"{url.lower()}||{name.lower()}"
            if key in seen:
                continue
            
            seen.add(key)
            merged.append({"name": name, "url": url})
    
    return merged

def group_articles_by_topic(articles: List[Dict], hours: int) -> List[Dict]:
    """Seskupí články podle tématu s časovým oknem"""
    if not articles or hours <= 0:
        return articles
    
    groups = {}
    
    # Seřadit podle publishedAt (ASC)
    sorted_articles = sorted(articles, key=lambda a: 
        datetime.fromisoformat(a.get("publishedAt", a.get("date", a.get("published", "1970-01-01T00:00:00Z"))).replace("Z", "+00:00")).timestamp())
    
    for article in sorted_articles:
        topic_key = compute_topic_key(article)
        if not topic_key:
            continue
        
        if topic_key not in groups:
            published_at = article.get("publishedAt") or article.get("date") or article.get("published") or ""
            try:
                first_time = datetime.fromisoformat(published_at.replace("Z", "+00:00")).timestamp()
            except:
                first_time = 0
            
            groups[topic_key] = {
                "primary": article,
                "related": [],
                "first_time": first_time,
                "time_window_end": first_time + (hours * 3600),
            }
        else:
            group = groups[topic_key]
            published_at = article.get("publishedAt") or article.get("date") or article.get("published") or ""
            try:
                article_time = datetime.fromisoformat(published_at.replace("Z", "+00:00")).timestamp()
            except:
                article_time = 0
            
            if article_time <= group["time_window_end"]:
                group["related"].append(article)
    
    result = []
    
    for topic_key, group in groups.items():
        primary = group["primary"]
        
        all_sources = [
            primary.get("sources", []) if isinstance(primary.get("sources"), list) else [],
        ]
        for related in group["related"]:
            if isinstance(related.get("sources"), list):
                all_sources.append(related["sources"])
        
        merged_sources = merge_sources_dedup(all_sources)
        
        if not primary.get("title") or not primary.get("url") or not isinstance(merged_sources, list):
            result.append(primary)
            continue
        
        grouped_article = {
            **primary,
            "sources": merged_sources,
            "_groupMeta": {
                "relatedCount": len(group["related"]),
                "timeWindow": f"{hours}h",
                "topicKey": topic_key,
            },
        }
        
        result.append(grouped_article)
    
    # Přidat články bez topicKey
    for article in sorted_articles:
        topic_key = compute_topic_key(article)
        if not topic_key:
            result.append(article)
    
    return result

def jaccard_similarity(str1: str, str2: str) -> float:
    """Vypočítá Jaccard podobnost mezi dvěma stringy"""
    tokens1 = set([t for t in str1.lower().split() if len(t) > 2])
    tokens2 = set([t for t in str2.lower().split() if len(t) > 2])
    
    intersection = tokens1 & tokens2
    union = tokens1 | tokens2
    
    return len(intersection) / len(union) if union else 0.0

def analyze_grouping(articles: List[Dict]) -> Dict:
    """Analyzuje seskupování článků"""
    input_count = len(articles)
    grouped = group_articles_by_topic(articles, 12)
    grouped_count = len(grouped)
    
    # Najít skupiny
    group_map = {}
    
    for article in grouped:
        if article.get("_groupMeta") and article["_groupMeta"].get("relatedCount", 0) > 0:
            key = article["_groupMeta"]["topicKey"]
            if key not in group_map:
                group_map[key] = {
                    "key": key,
                    "count": 1 + article["_groupMeta"]["relatedCount"],
                    "primary": article,
                    "related": [],
                    "times": [],
                    "sources": set(),
                    "topics": set(),
                    "sections": set(),
                    "titles": [],
                }
            
            group = group_map[key]
            try:
                time_val = datetime.fromisoformat(article.get("publishedAt", "").replace("Z", "+00:00")).timestamp()
                group["times"].append(time_val)
            except:
                pass
            
            if article.get("topic"):
                group["topics"].add(article["topic"])
            if article.get("section"):
                group["sections"].add(article["section"])
            if article.get("sources"):
                for s in article["sources"]:
                    if s.get("name"):
                        group["sources"].add(s["name"])
            group["titles"].append(article.get("title", ""))
    
    top_groups = sorted(group_map.values(), key=lambda g: g["count"], reverse=True)[:50]
    
    # Detekce podezřelých skupin
    suspicious = []
    
    for group in top_groups:
        issues = []
        
        # Kontrola tokenové podobnosti
        if len(group["titles"]) > 1:
            similarities = []
            for i in range(len(group["titles"])):
                for j in range(i + 1, len(group["titles"])):
                    sim = jaccard_similarity(group["titles"][i], group["titles"][j])
                    similarities.append(sim)
            if similarities:
                avg_sim = sum(similarities) / len(similarities)
                if avg_sim < 0.55:
                    issues.append(f"low_title_similarity:{avg_sim:.2f}")
        
        # Kontrola mixu topic/section
        if len(group["topics"]) > 1:
            issues.append(f"mixed_topics:{','.join(group['topics'])}")
        if len(group["sections"]) > 1:
            issues.append(f"mixed_sections:{','.join(group['sections'])}")
        
        # Kontrola duplicitních zdrojů
        source_names = set()
        source_urls = set()
        dup_names = 0
        dup_urls = 0
        
        if group["primary"].get("sources"):
            for s in group["primary"]["sources"]:
                name_lower = s.get("name", "").lower()
                url_lower = s.get("url", "").lower()
                if name_lower in source_names:
                    dup_names += 1
                if url_lower in source_urls:
                    dup_urls += 1
                if name_lower:
                    source_names.add(name_lower)
                if url_lower:
                    source_urls.add(url_lower)
        
        if dup_names > 0 or dup_urls > 0:
            issues.append(f"duplicate_sources:names={dup_names},urls={dup_urls}")
        
        if issues:
            suspicious.append({
                "key": group["key"],
                "count": group["count"],
                "issues": issues,
                "titles": group["titles"][:5],
                "sources": list(group["sources"])[:10],
            })
    
    return {
        "inputCount": input_count,
        "groupedCount": grouped_count,
        "reduction": input_count - grouped_count,
        "reductionPercent": round((input_count - grouped_count) / input_count * 100, 1) if input_count > 0 else 0,
        "topGroups": [
            {
                "key": g["key"],
                "count": g["count"],
                "timeRange": {
                    "min": datetime.fromtimestamp(min(g["times"])).isoformat() if g["times"] else "",
                    "max": datetime.fromtimestamp(max(g["times"])).isoformat() if g["times"] else "",
                },
                "sources": list(g["sources"])[:10],
                "topics": list(g["topics"]),
                "sections": list(g["sections"]),
                "titles": g["titles"][:5],
            }
            for g in top_groups
        ],
        "suspiciousCount": len(suspicious),
        "suspicious": suspicious[:20],
    }

def main():
    articles_path = Path(__file__).parent.parent.parent / "projects" / "data" / "articles.json"
    
    if not articles_path.exists():
        print(f"❌ File not found: {articles_path}")
        return
    
    with open(articles_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    articles = data.get("articles", [])
    if not articles:
        print("❌ No articles found in JSON")
        return
    
    print("🔍 Grouping Audit Report\n")
    print("=" * 80)
    
    report = analyze_grouping(articles)
    
    print(f"\n📊 SUMMARY")
    print(f"Input articles: {report['inputCount']}")
    print(f"Grouped articles: {report['groupedCount']}")
    print(f"Reduction: {report['reduction']} ({report['reductionPercent']}%)")
    print(f"Suspicious groups: {report['suspiciousCount']}")
    
    print(f"\n📈 TOP 10 GROUPS")
    for i, g in enumerate(report["topGroups"][:10], 1):
        key_display = g["key"][:60] + ("..." if len(g["key"]) > 60 else "")
        print(f"\n{i}. Key: \"{key_display}\"")
        print(f"   Count: {g['count']}")
        print(f"   Time range: {g['timeRange']['min']} → {g['timeRange']['max']}")
        sources_display = ", ".join(g["sources"][:5])
        if len(g["sources"]) > 5:
            sources_display += "..."
        print(f"   Sources ({len(g['sources'])}): {sources_display}")
        print(f"   Topics: {', '.join(g['topics']) or 'none'}")
        titles_display = " | ".join([f'"{t[:50]}{"..." if len(t) > 50 else ""}"' for t in g["titles"][:2]])
        print(f"   Titles: {titles_display}")
    
    if report["suspicious"]:
        print(f"\n⚠️  SUSPICIOUS GROUPS ({len(report['suspicious'])})")
        for i, s in enumerate(report["suspicious"][:10], 1):
            key_display = s["key"][:60] + ("..." if len(s["key"]) > 60 else "")
            print(f"\n{i}. Key: \"{key_display}\"")
            print(f"   Count: {s['count']}")
            print(f"   Issues: {', '.join(s['issues'])}")
            titles_display = " | ".join([f'"{t[:40]}{"..." if len(t) > 40 else ""}"' for t in s["titles"][:2]])
            print(f"   Titles: {titles_display}")
    
    print("\n" + "=" * 80)

if __name__ == "__main__":
    main()
