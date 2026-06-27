<div align="center">

# 🛡️ ShieldEye SurfaceScan

**Web attack-surface mapper**

*Subdomain discovery • Technology fingerprinting • Endpoint mapping*

[![Version](https://img.shields.io/badge/version-v1.0.0-1F6FEB?style=for-the-badge&labelColor=22272E)](#)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-1F6FEB?logo=node.js&logoColor=white&style=for-the-badge&labelColor=22272E)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-1F6FEB?style=for-the-badge&labelColor=22272E)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/exiv703/ShieldEye-SurfaceScan/test.yml?label=CI&logo=github&style=for-the-badge&labelColor=22272E&logoColor=white)](https://github.com/exiv703/ShieldEye-SurfaceScan/actions/workflows/test.yml)

[Features](#features) • [Screenshots](#screenshots) • [Architecture](#architecture) • [Quick Start](#quick-start) • [Configuration](#configuration) • [API](#api-usage)

</div>

---

## What is ShieldEye SurfaceScan?

SurfaceScan maps the externally exposed surface of a web target: it discovers
subdomains, verifies which ones actually resolve and respond, fingerprints the
technology behind them, and crawls reachable endpoints within a fixed scope. The
output is a clean JSON inventory of hosts, detected tech with confidence scores,
and the endpoints it found.

It's built around conservative scan behaviour. Discovery starts from passive
OSINT sources (`crt.sh`, SecurityTrails) and only then does light active
verification (DNS + HTTP `HEAD`). Crawling is bounded by depth and page caps and
uses `GET`/`HEAD` only. If a target's host resolves to a private, loopback, or
cloud-metadata address, it's rejected before any request goes out.

It's aimed at people doing recon on assets they're responsible for: bug-bounty
scope mapping, external-asset inventory, pre-engagement footprinting. It is not a
full DAST scanner and won't try to exploit anything it finds.

> ⚠️ **Authorized use only.** Only scan systems you own or have explicit written
> permission to assess.

---

## Features

<table>
<tr>
<td width="50%">

### Discovery
- **Passive OSINT** via `crt.sh` and SecurityTrails
- **Active verification** with DNS resolution + HTTP `HEAD`
- **SSRF-safe**: loopback, private ranges, and metadata
  endpoints are blocked, redirects re-checked

</td>
<td width="50%">

### Fingerprinting
- **Header analysis** (`Server`, `X-Powered-By`, …)
- **HTML/JS signature matching** for frameworks
- **Explainable scoring**: each `confidence_score`
  carries a per-signal evidence breakdown

</td>
</tr>
<tr>
<td width="50%">

### Endpoint mapping
- **In-scope crawling** with depth and page caps
- **`GET`/`HEAD` only**, no state-changing requests
- **Normalization + dedupe**: lowercased hosts,
  sorted query params, fragments stripped

</td>
<td width="50%">

### Safe defaults
- **Per-host rate limiting** (token bucket +
  `Retry-After` handling)
- **TLS validation on** by default, custom CA support
- **CI quality gates**, pre-commit hooks, **72 tests** (Jest)

</td>
</tr>
</table>

---

## Screenshots

<div align="center">

| Surface Overview | Discovery Results |
|:--:|:--:|
| ![Surface Overview](docs/screenshots/dashboard.png) | ![Discovery Results](docs/screenshots/results.png) |

| Analytics Overview | New Scan |
|:--:|:--:|
| ![Analytics Overview](docs/screenshots/analytics.png) | ![New Scan](docs/screenshots/new-scan.png) |

</div>

---

## Architecture

Three independent stages behind a small REST API, so discovery, fingerprinting,
and endpoint mapping can be tuned or tested without touching each other:

```text
┌─────────────────────────────────┐
│   ShieldEye SurfaceScan         │
│   REST API (Node + TypeScript)  │
└────────────┬────────────────────┘
             │
    ┌────────┴────────┐
    ▼                 ▼
┌──────────┐   ┌──────────────┐
│Discovery │   │Fingerprint   │
│OSINT +   │   │Headers +     │
│DNS + HTTP│   │HTML + JS     │
└────┬─────┘   └──────┬───────┘
     │                │
     ▼                ▼
┌─────────────────────────────┐
│   Endpoint Mapper           │
│   Crawl + Dedupe + Rate     │
└────────────┬────────────────┘
             ▼
┌─────────────────────────────┐
│   JSON findings             │
│   • host + status           │
│   • tech + confidence       │
│   • endpoints + methods     │
└─────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **API** | Node.js 18+, TypeScript, Express |
| **Validation** | `zod` schemas on external-facing structures |
| **Storage** | PostgreSQL + MinIO (via Docker Compose) |
| **GUI (auxiliary)** | GTK / PyGObject (`gtk_gui_pro`) |
| **Quality** | Jest, ESLint, pre-commit |

---

## Quick Start

Shortest path to a first scan: install deps, copy `.env`, run the API, send one
`curl`.

### 1. Clone

```bash
git clone https://github.com/exiv703/ShieldEye-SurfaceScan.git
cd ShieldEye-SurfaceScan
```

### 2. Install dependencies

```bash
npm ci --prefix shared
npm ci --prefix api
npm ci --prefix analyzer
```

### 3. Configure environment

```bash
cp .env.example .env
```

Set real values for `DB_PASSWORD`, `MINIO_SECRET_KEY`, `JWT_SECRET`, and
`ENCRYPTION_KEY` before running anywhere shared. Placeholders are fine for
local-only work as long as you rotate them before pushing.

### 4. Run

```bash
# Full stack with containers
docker compose up -d

# or local API dev mode
npm run dev --prefix api
```

### 5. Trigger a scan

```bash
curl -X POST http://localhost:3000/api/scans \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

The GTK GUI (`gtk_gui_pro`) exists as an auxiliary interface, but the primary
v1.0.0 flow is API/CLI-driven. If a scan is created but results come back empty,
check the API logs first.

---

## Configuration

### Runtime flags

| Variable | Default | Description |
|---|---:|---|
| `ENABLE_EXPERIMENTAL_API` | `false` | Enables experimental stub routes (`/api/monitoring`, `/api/blockchain`, `/api/quantum`, `/api/settings`) |
| `ENABLE_MINIMAL_ROUTES` | `false` | Enables the legacy minimal API router under `/api/minimal` |
| `ENABLE_METRICS` | `true` | Exposes the `/metrics` endpoint |
| `ENABLE_HEALTH_CHECKS` | `true` | Enables health/readiness/liveness endpoints |
| `BROWSER_IGNORE_HTTPS_ERRORS` | `false` | Dev-only: bypass TLS validation in renderer browser contexts |
| `MINIO_USE_SSL` | _(auto / explicit)_ | Forces MinIO client TLS transport (`true`/`false`) |

### TLS (secure by default)

| Variable | Default | Description |
|---|---:|---|
| `TLS_ENABLED` | `true` | Enables TLS-aware client configuration |
| `TLS_REJECT_UNAUTHORIZED` | `true` | Rejects invalid/untrusted certificates |
| `TLS_CA_CERT_PATH` | _(unset)_ | Optional custom CA certificate path |
| `TLS_MIN_VERSION` | `TLSv1.2` | Minimum accepted TLS version (`TLSv1.2` / `TLSv1.3`) |

The experimental routes are intentionally stubs. Keep `ENABLE_EXPERIMENTAL_API=false`
on anything shared unless someone is actively working on them.

---

## Documentation

| Document | Purpose |
|---|---|
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | Platform requirements and setup baseline |
| [`docs/guides/INTEGRATION_GUIDE.md`](docs/guides/INTEGRATION_GUIDE.md) | Backend + GUI integration notes |
| [`docs/reports/SHIELDEYE_BACKEND_SCANNER_REPORT.md`](docs/reports/SHIELDEYE_BACKEND_SCANNER_REPORT.md) | Architecture/report context |

---

## API Usage

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/scans` | Create scan |
| `GET` | `/api/scans/:id/status` | Get scan status |
| `GET` | `/api/scans/:id/results` | Get scan results |
| `GET` | `/api/scans/:id/surface` | Get mapped attack surface |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Metrics (if enabled) |

### Create and poll a scan (TypeScript)

Plain `fetch`, no SDK wrapper, so it drops straight into a script or CI smoke check:

```ts
type CreateScanResponse = { id: string; status: string };

async function createAndPollScan(baseUrl: string, targetUrl: string) {
  const createRes = await fetch(`${baseUrl}/api/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl }),
  });
  if (!createRes.ok) throw new Error(`Scan creation failed: ${createRes.status}`);

  const { id: scanId } = (await createRes.json()) as CreateScanResponse;

  for (;;) {
    const statusRes = await fetch(`${baseUrl}/api/scans/${scanId}/status`);
    if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);

    const { status } = await statusRes.json();
    if (status === "completed") {
      const resultsRes = await fetch(`${baseUrl}/api/scans/${scanId}/results`);
      if (!resultsRes.ok) throw new Error(`Results fetch failed: ${resultsRes.status}`);
      return resultsRes.json();
    }
    if (status === "failed") throw new Error(`Scan ${scanId} failed`);

    await new Promise((r) => setTimeout(r, 1500));
  }
}
```

---

## Development

```bash
# Lint
npx --no-install --prefix api eslint .
npx --no-install --prefix analyzer eslint .

# Typecheck
npx --no-install --prefix api tsc --noEmit
npx --no-install --prefix analyzer tsc --noEmit

# Tests
npm test --prefix api -- --ci
npm test --prefix analyzer -- --ci

# Pre-commit hooks
pip install pre-commit
pre-commit install
```

---

## Contributing

Keep changes small and test-backed. The things that matter here:

- Type external-facing structures explicitly (`zod` schemas, interfaces).
- Add or update tests for scanner, validation, and orchestration logic.
- Don't weaken the secure defaults: SSRF protections, TLS validation, bounded
  crawling.

Before opening a PR, make sure lint, typecheck, and tests pass and no secrets or
unsafe defaults slipped in.

---

## License

MIT - see [LICENSE](LICENSE). For educational and authorized security testing only.

---

## Related Projects

Part of the **ShieldEye** toolkit:

- **[ShieldEye Core](https://github.com/exiv703/ShieldEye-Core)** - network security scanner (Nmap + GTK4)
- **[ShieldEye NeuralScan](https://github.com/exiv703/ShieldEye-NeuralScan)** - local source-code security scanner
- **[ShieldEye ComplianceScan](https://github.com/exiv703/ShieldEye_ComplianceScan)** - GDPR / PCI-DSS / ISO 27001 compliance scanner
