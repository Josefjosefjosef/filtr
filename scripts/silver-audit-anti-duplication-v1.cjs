/**
 * Silver Audit Anti-Duplication V1 — governance layer (scripts-only).
 * Semantic overlap, lexical overlap, near-duplicate rejection, entropy scoring.
 */
"use strict";

const GOVERNANCE_ID = "silver_audit_anti_duplication_v1";

const { foldCs } = require("./silver-semantic-payload-engine-v1-core.cjs");

function tokenSet(text) {
  const fold = foldCs(text);
  return new Set(
    fold
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2)
  );
}

function jaccardSimilarity(a, b) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (!sa.size && !sb.size) return 1;
  let inter = 0;
  sa.forEach((t) => {
    if (sb.has(t)) inter++;
  });
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function charNgramSet(text, n) {
  const fold = foldCs(text).replace(/\s+/g, " ");
  const grams = new Set();
  for (let i = 0; i <= fold.length - n; i++) {
    grams.add(fold.slice(i, i + n));
  }
  return grams;
}

function ngramJaccard(a, b, n) {
  const ga = charNgramSet(a, n);
  const gb = charNgramSet(b, n);
  if (!ga.size && !gb.size) return 1;
  let inter = 0;
  ga.forEach((g) => {
    if (gb.has(g)) inter++;
  });
  const union = ga.size + gb.size - inter;
  return union ? inter / union : 0;
}

function shannonEntropy(text) {
  const fold = foldCs(text).replace(/\s+/g, "");
  if (!fold.length) return 0;
  const freq = {};
  for (let i = 0; i < fold.length; i++) {
    const c = fold[i];
    freq[c] = (freq[c] || 0) + 1;
  }
  let h = 0;
  const keys = Object.keys(freq);
  for (let j = 0; j < keys.length; j++) {
    const p = freq[keys[j]] / fold.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function uniqueTokenRatio(text) {
  const tokens = foldCs(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

function isNearDuplicate(candidate, accepted, thresholds) {
  const th = thresholds || {};
  const semanticMax = th.semanticMax != null ? th.semanticMax : 0.82;
  const lexicalMax = th.lexicalMax != null ? th.lexicalMax : 0.88;
  const minEntropy = th.minEntropy != null ? th.minEntropy : 2.0;

  const candInput = String(candidate.input || candidate.text || candidate);
  if (shannonEntropy(candInput) < minEntropy && candInput.length > 12) return { reject: true, reason: "low_entropy" };

  for (let i = 0; i < accepted.length; i++) {
    const accInput = String(accepted[i].input || accepted[i].text || accepted[i]);
    const sem = jaccardSimilarity(candInput, accInput);
    const lex = ngramJaccard(candInput, accInput, 3);
    if (sem >= semanticMax || lex >= lexicalMax) {
      return { reject: true, reason: sem >= semanticMax ? "semantic_overlap" : "lexical_overlap", score: Math.max(sem, lex) };
    }
  }
  return { reject: false };
}

function scoreTemplateDnaQuality(template) {
  const t = String(template || "");
  const entropy = shannonEntropy(t);
  const utr = uniqueTokenRatio(t);
  const hasEntity = /\{[a-z_]+\}/.test(t) || /\b(novotn|petr|martin|jana|praha|brno)\b/i.test(t);
  const hasAction = /\b(uloz|ulož|schuzk|schůzk|ukol|úkol|poznam|poznám|kolik|vypis|vypiš)\b/i.test(foldCs(t));
  let score = entropy * 0.4 + utr * 2.0;
  if (hasEntity) score += 1.5;
  if (hasAction) score += 1.0;
  if (t.length < 15) score -= 1.0;
  if (t.length > 120) score += 0.5;
  return {
    score: Math.round(score * 100) / 100,
    entropy: Math.round(entropy * 100) / 100,
    unique_token_ratio: Math.round(utr * 100) / 100,
    has_entity: hasEntity,
    has_action: hasAction,
  };
}

function mutationUniquenessScore(original, mutated) {
  const sem = jaccardSimilarity(original, mutated);
  const lex = ngramJaccard(original, mutated, 3);
  return {
    semantic_distance: Math.round((1 - sem) * 100) / 100,
    lexical_distance: Math.round((1 - lex) * 100) / 100,
    unique_enough: sem < 0.75 && lex < 0.8,
  };
}

function filterUniqueCases(cases, options) {
  const opts = options || {};
  const accepted = [];
  const rejected = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const dup = isNearDuplicate(c, accepted, opts);
    if (dup.reject) {
      rejected.push({ case: c, reason: dup.reason, score: dup.score });
    } else {
      accepted.push(c);
    }
  }
  return { accepted, rejected, acceptance_rate: cases.length ? accepted.length / cases.length : 1 };
}

function auditGovernanceReport(cases) {
  const dnaScores = [];
  for (let i = 0; i < cases.length; i++) {
    dnaScores.push(scoreTemplateDnaQuality(cases[i].input || cases[i].template || ""));
  }
  const filtered = filterUniqueCases(cases);
  const avgEntropy =
    dnaScores.length ? dnaScores.reduce((s, d) => s + d.entropy, 0) / dnaScores.length : 0;
  const avgDna =
    dnaScores.length ? dnaScores.reduce((s, d) => s + d.score, 0) / dnaScores.length : 0;
  return {
    total_generated: cases.length,
    accepted_unique: filtered.accepted.length,
    rejected_duplicates: filtered.rejected.length,
    acceptance_rate: filtered.acceptance_rate,
    avg_entropy: Math.round(avgEntropy * 100) / 100,
    avg_template_dna_score: Math.round(avgDna * 100) / 100,
    anti_duplicate_protection: "ACTIVE",
    semantic_entropy_governance: avgEntropy >= 2.0 ? "PASS" : "REVIEW",
    template_dna_quality_governance: avgDna >= 3.5 ? "PASS" : "REVIEW",
  };
}

module.exports = {
  GOVERNANCE_ID,
  tokenSet,
  jaccardSimilarity,
  ngramJaccard,
  shannonEntropy,
  uniqueTokenRatio,
  isNearDuplicate,
  scoreTemplateDnaQuality,
  mutationUniquenessScore,
  filterUniqueCases,
  auditGovernanceReport,
};
