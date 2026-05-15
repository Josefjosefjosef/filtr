# Silver strategy (infoUzel.cz)

- **Local browser-only**: Silver runs entirely in the user’s browser; no server-side Silver runtime.
- **No backend AI**: no hosted inference, no cloud model calls in production paths.
- **No runtime LLM / embeddings / cloud inference** in Silver itself.
- **Diagnostic-first**: measure, classify failures, and narrow scope before changing behavior.
- **Cluster-driven**: prioritize work by RHC3 / corpus clusters, not broad rewrites.
- **Safety-first**: negation, read-only, and write gates must stay at zero counter regressions.
- **Zero-regression**: ship only with smoke + calendar + routing + quality + mobile + corpus proofs green.
- **Engine fix only after `TRUE_ENGINE_FAIL`**: do not treat harness noise or gold drift as engine defects without proof.
- **Scripts-only harness / gold alignment** when the engine is not demonstrably wrong.
- **No broad refactors**: small, reviewable diffs with explicit intent.
- **Done only after proof**: merge is not completion until post-merge audits pass.
