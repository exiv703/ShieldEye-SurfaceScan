# ShieldEye SurfaceScan – Backend & GUI Integration Guide

## Modern Desktop Integration (GTK Pro GUI)

This guide describes how the **ShieldEye backend API** integrates with the **ShieldEye SurfaceScan GTK desktop GUI**. It focuses on the current production-ready stack, not on earlier PyQt/WebSocket experiments.

At a high level:

- The **backend** (API + Analyzer + Renderer + PostgreSQL + Redis + MinIO) runs as Docker services.
- The **GTK GUI** (`gtk_gui_pro`) talks to the API over **HTTP/JSON**.
- The GUI uses the API for:
  - creating and monitoring scans,
  - fetching scan results and analytics,
  - triggering AI analysis via the LLM endpoint,
  - reading queue/health information for monitoring views.

The goal of this document is to explain **how they fit together in practice** and how to run them side by side.

---

## 1. Architecture Overview

### 1.1 Components

- **API service (`api/`)** – Node.js/Express, exposes REST endpoints such as:
  - `POST /api/scans` – create scan
  - `GET /api/scans/:id/status` – poll scan status
  - `GET /api/scans/:id/results` – fetch minimal analyzer results
  - `GET /api/analytics/summary` – dashboard metrics
  - `GET /api/queue/stats` – queue statistics
  - `POST /api/ai/llm/generate` – AI/LLM analysis

- **Desktop GUI (`gtk_gui_pro/`)** – Python 3 + GTK 3 application which:
  - uses an `APIClient` class to call the API over HTTP,
  - shows Dashboard, Results, Analytics, AI views etc.,
  - automatically refreshes analytics after a scan completes.

Both sides are configured primarily via **environment variables** and the root `.env` file (see `README.md` and `REQUIREMENTS.md`).

### 1.2 Data Flow

1. The user enters a target URL in the GTK GUI and starts a scan.
2. The GUI calls `POST /api/scans` with the scan parameters.
3. The API enqueues work for the analyzer/renderer and stores metadata in PostgreSQL.
4. The GUI periodically calls `GET /api/scans/:id/status` until the scan is `completed` or `failed`.
5. When the scan completes, the GUI calls `GET /api/scans/:id/results` to fetch findings and library data.
6. The Dashboard and Analytics views call `GET /api/analytics/summary` to show overall statistics.
7. The AI view calls `POST /api/ai/llm/generate` with a structured JSON context to get human‑readable recommendations.

There is **no hard dependency on WebSockets** for the GTK GUI. All communication is HTTP-based, which keeps the integration simple and robust.

---

## 2. How to Run Backend and GUI Together

You have two main options: use the **launcher script** or start components manually.

### 2.1 Recommended: launcher script (`gtk_gui_pro/run.sh`)

From the project root:

```bash
cd gtk_gui_pro
./run.sh
```

Choose:

- `1) Full stack (backend + API + GUI)` to start Docker services and the GUI, or
- `2) GUI only` if the backend is already running.

The script will:

- check local dependencies (Python, GTK, PyGObject),
- ensure the API is reachable at `SHIELDEYE_API_URL` (default `http://localhost:3000`),
- start Docker services when necessary (`postgres`, `redis`, `minio`, `api`, `renderer`, `analyzer`),
- launch the GTK GUI.

### 2.2 Manual backend start (developers)

```bash
cd /path/to/shieldeye
docker compose up -d postgres redis minio api renderer analyzer
```

Then start the GUI:

```bash
cd /path/to/shieldeye/gtk_gui_pro
python3 main.py
```

As long as the GUI can reach `http://localhost:3000`, integration will work.

---

## 3. Configuration

### 3.1 API URL used by the GUI

The GTK GUI uses the `SHIELDEYE_API_URL` environment variable. The launcher sets a sensible default:

```bash
export SHIELDEYE_API_URL=http://localhost:3000
```

You can override this when connecting to a remote backend:

```bash
SHIELDEYE_API_URL=https://your-api.example.com ./run.sh --mode gui
```

### 3.2 Backend environment

At the project root:

```bash
cp .env.example .env
```

Then edit `.env` to set:

- PostgreSQL, Redis and MinIO credentials,
- `JWT_SECRET` and `ENCRYPTION_KEY`,
- LLM configuration (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, etc.).

These values are consumed by the API and analyzer; the GUI only needs a working API URL.

---

## 4. What the GUI expects from the API

The GTK GUI assumes that the API:

- exposes the core scan endpoints (`/api/scans`, `/api/scans/:id/status`, `/api/scans/:id/results`),
- exposes `/api/analytics/summary` for dashboard and analytics cards,
- exposes `/api/queue/stats` for queue health,
- optionally exposes `/api/ai/llm/generate` for the AI Analysis view.

The exact JSON formats are defined in the shared TypeScript types (`shared/`) and mirrored in the Python `APIClient` implementation.

If a particular endpoint is not available (for example AI), the GUI is designed to fail gracefully and show an error message instead of crashing.

---

## 5. Troubleshooting Integration

- **GUI cannot connect to API**
  - Check that Docker services are running: `docker compose ps`.
  - Confirm that `SHIELDEYE_API_URL` points to a reachable host/port.
  - Open `http://localhost:3000/health` in a browser to verify the API.

- **Analytics or dashboard stay at zero**
  - Make sure you have run at least one scan and opened its **Results** view so the minimal analyzer can persist findings.
  - Use the launcher option `5) Reset analytics data (truncate DB)` only when you intentionally want to wipe demo data.

- **AI analysis does not work**
  - Verify that your LLM service (e.g. Ollama) is running and matches `LLM_BASE_URL` and `LLM_MODEL` in `.env`.
  - Check the API logs for errors on `/api/ai/llm/generate`.

---

*Created by the ShieldEye CEO*



