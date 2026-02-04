#!/usr/bin/env node
/**
 * Grouping Audit Script
 * Analyzuje reálná data z articles.json a simuluje topic grouping
 * pro detekci false positives a duplicitních zdrojů
 */

const fs = require('fs');
const path = require('path');

// Duplikace logiky z app.js
function normalizeTitleForKey(title) {
  if (!title || typeof title !== "string") return "";
  
  let normalized = title
    .toLowerCase()
    .replace(/[áàä]/g, "a")
    .replace(/[éèě]/g, "e")
    .replace(/[íì]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùůü]/g, "u")
    .replace(/[ý]/g, "y")
    .replace(/[č]/g, "c")
    .replace(/[ď]/g, "d")
    .replace(/[ň]/g, "n")
    .replace(/[ř]/g, "r")
    .replace(/[š]/g, "s")
    .replace(/[ť]/g, "t")
    .replace(/[ž]/g, "z")
    .replace(/[^\w\s]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  const softStopWords = ["video", "zive", "aktualne", "live", "breaking"];
  const words = normalized.split(/\s+/);
  const filtered = words.filter(w => w.length > 2 && !softStopWords.includes(w));
  
  return filtered.join(" ");
}

function computeTopicKey(article) {
  if (!article) return null;
  
  const title = article.title || article.headline || article.name || "";
  const normalizedTitle = normalizeTitleForKey(title);
  
  if (normalizedTitle.length < 10) {
    const topic = (article.topic || "").toLowerCase().trim();
    const section = (article.section || "").toLowerCase().trim();
    if (topic || section) {
      return `${topic}||${section}`;
    }
  }
  
  return normalizedTitle || null;
}

function mergeSourcesDedup(sourcesArrayList) {
  const seen = new Set();
  const merged = [];
  
  for (const sources of sourcesArrayList) {
    if (!Array.isArray(sources)) continue;
    
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      
      const name = String(source.name || source.title || "").trim();
      const url = String(source.url || source.link || "").trim();
      
      if (!name || !url) continue;
      
      const key = `${url.toLowerCase()}||${name.toLowerCase()}`;
      
      if (seen.has(key)) continue;
      seen.add(key);
      
      merged.push({ name, url });
    }
  }
  
  return merged;
}

function groupArticlesByTopic(articles, hours) {
  if (!Array.isArray(articles) || articles.length === 0) return articles;
  if (!Number.isFinite(hours) || hours <= 0) return articles;
  
  const groups = new Map();
  
  const sorted = [...articles].sort((a, b) => {
    const ta = new Date(a.publishedAt || a.date || a.published || 0).getTime();
    const tb = new Date(b.publishedAt || b.date || b.published || 0).getTime();
    return ta - tb;
  });
  
  for (const article of sorted) {
    const topicKey = computeTopicKey(article);
    if (!topicKey) continue;
    
    if (!groups.has(topicKey)) {
      const publishedAt = article.publishedAt || article.date || article.published || "";
      const firstTime = new Date(publishedAt).getTime();
      
      groups.set(topicKey, {
        primary: article,
        related: [],
        firstTime: firstTime,
        timeWindowEnd: firstTime + (hours * 60 * 60 * 1000),
      });
    } else {
      const group = groups.get(topicKey);
      const articleTime = new Date(article.publishedAt || article.date || article.published || 0).getTime();
      
      if (articleTime <= group.timeWindowEnd) {
        group.related.push(article);
      }
    }
  }
  
  const result = [];
  
  for (const [topicKey, group] of groups.entries()) {
    const primary = group.primary;
    
    const allSources = [
      Array.isArray(primary.sources) ? primary.sources : [],
      ...group.related.map(a => Array.isArray(a.sources) ? a.sources : [])
    ];
    const mergedSources = mergeSourcesDedup(allSources);
    
    if (!primary.title || !primary.url || !Array.isArray(mergedSources)) {
      result.push(primary);
      continue;
    }
    
    const groupedArticle = {
      ...primary,
      sources: mergedSources,
      _groupMeta: {
        relatedCount: group.related.length,
        timeWindow: `${hours}h`,
        topicKey: topicKey,
      },
    };
    
    result.push(groupedArticle);
  }
  
  for (const article of sorted) {
    const topicKey = computeTopicKey(article);
    if (!topicKey) {
      result.push(article);
    }
  }
  
  return result;
}

// Jaccard similarity pro detekci false positives
function jaccardSimilarity(str1, str2) {
  const tokens1 = new Set(str1.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  const tokens2 = new Set(str2.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);
  
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Hlavní analýza
function analyzeGrouping(articles) {
  const inputCount = articles.length;
  const grouped = groupArticlesByTopic(articles, 12);
  const groupedCount = grouped.length;
  
  // Najít skupiny (články s _groupMeta)
  const groups = grouped.filter(a => a._groupMeta && a._groupMeta.relatedCount > 0);
  const groupMap = new Map();
  
  for (const article of grouped) {
    if (article._groupMeta && article._groupMeta.relatedCount > 0) {
      const key = article._groupMeta.topicKey;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          count: 1 + article._groupMeta.relatedCount,
          primary: article,
          related: [],
          times: [],
          sources: new Set(),
          topics: new Set(),
          sections: new Set(),
          titles: [],
        });
      }
      
      const group = groupMap.get(key);
      group.times.push(new Date(article.publishedAt).getTime());
      if (article.topic) group.topics.add(article.topic);
      if (article.section) group.sections.add(article.section);
      if (article.sources) {
        article.sources.forEach(s => group.sources.add(s.name));
      }
      group.titles.push(article.title);
    }
  }
  
  // TOP skupiny
  const topGroups = Array.from(groupMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
  
  // Detekce podezřelých skupin
  const suspicious = [];
  
  for (const group of topGroups) {
    const issues = [];
    
    // Kontrola tokenové podobnosti titulků
    if (group.titles.length > 1) {
      const similarities = [];
      for (let i = 0; i < group.titles.length; i++) {
        for (let j = i + 1; j < group.titles.length; j++) {
          const sim = jaccardSimilarity(group.titles[i], group.titles[j]);
          similarities.push(sim);
        }
      }
      const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;
      if (avgSim < 0.55) {
        issues.push(`low_title_similarity:${avgSim.toFixed(2)}`);
      }
    }
    
    // Kontrola mixu topic/section
    if (group.topics.size > 1) {
      issues.push(`mixed_topics:${Array.from(group.topics).join(',')}`);
    }
    if (group.sections.size > 1) {
      issues.push(`mixed_sections:${Array.from(group.sections).join(',')}`);
    }
    
    // Kontrola duplicitních zdrojů v merged sources
    const sourceNames = new Set();
    const sourceUrls = new Set();
    let dupNames = 0;
    let dupUrls = 0;
    
    if (group.primary.sources) {
      for (const s of group.primary.sources) {
        if (sourceNames.has(s.name?.toLowerCase())) dupNames++;
        if (sourceUrls.has(s.url?.toLowerCase())) dupUrls++;
        if (s.name) sourceNames.add(s.name.toLowerCase());
        if (s.url) sourceUrls.add(s.url.toLowerCase());
      }
    }
    
    if (dupNames > 0 || dupUrls > 0) {
      issues.push(`duplicate_sources:names=${dupNames},urls=${dupUrls}`);
    }
    
    if (issues.length > 0) {
      suspicious.push({
        key: group.key,
        count: group.count,
        issues,
        titles: group.titles.slice(0, 5),
        sources: Array.from(group.sources),
      });
    }
  }
  
  return {
    inputCount,
    groupedCount,
    reduction: inputCount - groupedCount,
    reductionPercent: ((inputCount - groupedCount) / inputCount * 100).toFixed(1),
    topGroups: topGroups.map(g => ({
      key: g.key,
      count: g.count,
      timeRange: {
        min: new Date(Math.min(...g.times)).toISOString(),
        max: new Date(Math.max(...g.times)).toISOString(),
      },
      sources: Array.from(g.sources),
      topics: Array.from(g.topics),
      sections: Array.from(g.sections),
      titles: g.titles.slice(0, 5),
    })),
    suspiciousCount: suspicious.length,
    suspicious,
  };
}

// Main
const articlesPath = path.join(__dirname, '../../projects/data/articles.json');

if (!fs.existsSync(articlesPath)) {
  console.error(`❌ File not found: ${articlesPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(articlesPath, 'utf8'));
const articles = Array.isArray(data.articles) ? data.articles : [];

if (articles.length === 0) {
  console.error('❌ No articles found in JSON');
  process.exit(1);
}

console.log('🔍 Grouping Audit Report\n');
console.log('='.repeat(80));

const report = analyzeGrouping(articles);

console.log(`\n📊 SUMMARY`);
console.log(`Input articles: ${report.inputCount}`);
console.log(`Grouped articles: ${report.groupedCount}`);
console.log(`Reduction: ${report.reduction} (${report.reductionPercent}%)`);
console.log(`Suspicious groups: ${report.suspiciousCount}`);

console.log(`\n📈 TOP 10 GROUPS`);
report.topGroups.slice(0, 10).forEach((g, i) => {
  console.log(`\n${i + 1}. Key: "${g.key.substring(0, 60)}${g.key.length > 60 ? '...' : ''}"`);
  console.log(`   Count: ${g.count}`);
  console.log(`   Time range: ${g.timeRange.min} → ${g.timeRange.max}`);
  console.log(`   Sources (${g.sources.length}): ${g.sources.slice(0, 5).join(', ')}${g.sources.length > 5 ? '...' : ''}`);
  console.log(`   Topics: ${g.topics.join(', ') || 'none'}`);
  console.log(`   Titles: ${g.titles.slice(0, 2).map(t => `"${t.substring(0, 50)}${t.length > 50 ? '...' : ''}"`).join(' | ')}`);
});

if (report.suspicious.length > 0) {
  console.log(`\n⚠️  SUSPICIOUS GROUPS (${report.suspicious.length})`);
  report.suspicious.slice(0, 10).forEach((s, i) => {
    console.log(`\n${i + 1}. Key: "${s.key.substring(0, 60)}${s.key.length > 60 ? '...' : ''}"`);
    console.log(`   Count: ${s.count}`);
    console.log(`   Issues: ${s.issues.join(', ')}`);
    console.log(`   Titles: ${s.titles.slice(0, 2).map(t => `"${t.substring(0, 40)}${t.length > 40 ? '...' : ''}"`).join(' | ')}`);
  });
}

console.log('\n' + '='.repeat(80));
