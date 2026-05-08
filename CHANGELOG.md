# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-08

### Added
- Step 1.0: Expanded API-side minimal analysis pipeline with inline JavaScript pattern detection, security-header checks, cookie hardening checks, third-party script/SRI findings, and OSV vulnerability enrichment.
- Step 1.1: Added AI generation endpoint (`/api/ai/llm/generate`) with configurable model/runtime parameters and context-aware prompt support.
- Step 2.0: Added production-ready analytics summary endpoint (`/api/analytics/summary`) consumed by dashboard and reporting surfaces.
- Step 2.1: Added release gating automation via pre-commit quality checks (ESLint, TypeScript, secret detection, Python security guardrails).
- Step 2.2: Added integration-focused analyzer service tests for `analysis_engine`, `scan_service`, and `result_persister` orchestration.
- Step 3.0: Added CI quality gates across Node.js 18/20/22 for linting, type checks, tests, coverage thresholds, and Bandit scanning.

### Changed
- Refactored analytics data flow to favor fresh server reads where required, improving dashboard consistency after scan completion.
- Improved architecture alignment between API, analyzer worker, and persistence layers for deterministic transaction/pipeline behavior.
- Standardized health, queue, and metrics validation paths to support production readiness checks.

### Fixed
- Hardened runtime and deployment defaults by requiring sensitive credentials in containerized environments (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `MINIO_SECRET_KEY`) and enabling TLS-related defaults.
- Reduced stale analytics behavior by removing cache reliance for volatile summary endpoints in client-facing flows.
- Improved reliability of scan-result persistence and risk score propagation used by analytics and dashboard views.

### Removed
- Removed legacy dependence on stale analytics response caching in runtime dashboard refresh paths.
