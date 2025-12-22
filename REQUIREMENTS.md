# ShieldEye SurfaceScan Requirements

This document is a **human-readable guide** listing the practical requirements to run ShieldEye SurfaceScan locally with the full stack (API, Analyzer, Renderer, PostgreSQL, Redis, MinIO) and the GTK desktop GUI.

It is **not** a `requirements.txt` file for pip. For Python package versions, see `gtk_gui_pro/requirements.txt`.

---

## 1. System Requirements

- **Operating System**
  - Linux (tested on modern distributions)

- **Core tools**
  - `git`
  - `curl`
  - `pkg-config`

- **Docker & Docker Compose**
  - Docker Engine (recent stable version)
  - `docker compose` CLI plugin
  - Used to run: PostgreSQL, Redis, MinIO, API, Analyzer, Renderer

- **Node.js / npm (for local development, optional if you only use Docker)**
  - Node.js **18+**
  - npm (comes with Node)

- **Python & GTK (for the desktop GUI)**
  - Python **3.10+**
  - GTK+ 3 development libraries
    - Example install commands:
      - Arch: `sudo pacman -S gtk3`
      - Ubuntu/Debian: `sudo apt install libgtk-3-dev`
  - PyGObject bindings for Python 3
    - Arch: `sudo pacman -S python-gobject`
    - Ubuntu/Debian: `sudo apt install python3-gi`

- **Optional: LLM / AI backend**
  - An LLM service compatible with the configured API (e.g. **Ollama** on `http://localhost:11434`), if you want AI analysis, hardening and injection lab features.

---

## 2. Project Services & Dependencies

ShieldEye SurfaceScan is split into several services:

- `api/` – Node.js / TypeScript API gateway (Express, Bull, PostgreSQL, Redis, MinIO)
- `renderer/` – Node.js / TypeScript service using Playwright for headless browsing
- `analyzer/` – Node.js / TypeScript analysis engine
- `gtk_gui_pro/` – Python GTK3 desktop GUI
- `shared/` – Shared TypeScript library with types and utilities

### 2.1 JavaScript / TypeScript dependencies

All JavaScript/TypeScript dependencies (for `api`, `renderer`, `analyzer`, `shared`) are installed **automatically inside Docker images** when you run:

```bash
./run.sh           # and choose full stack
# or
cd shieldeye   # or the directory where you cloned the repo
docker compose up -d
```

If you want to develop locally **outside Docker**, run `npm install` in each service directory (for example):

```bash
cd api && npm install
cd ../renderer && npm install
cd ../analyzer && npm install
cd ../shared && npm install
```

### 2.2 Python (GTK GUI) dependencies

Python dependencies for the GTK GUI live in:

```text
gtk_gui_pro/requirements.txt
```

To install them manually:

```bash
cd gtk_gui_pro
pip3 install --user -r requirements.txt
```

Alternatively, you can let the launcher do this for you (see below).

---

## 3. Environment Configuration

ShieldEye SurfaceScan uses a `.env` file at the project root to configure services.

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Adjust values as needed:

   - Database credentials (PostgreSQL)
   - Redis and MinIO configuration
   - Security secrets:
     - `JWT_SECRET`
     - `ENCRYPTION_KEY`
   - LLM configuration (if used):
     - `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, etc.

> **Important:** The `.env` file is **ignored by git**. Only `.env.example` is committed. Before any real deployment or open‑source release, you **must** use unique, strong secrets and never commit real credentials.

---

## 4. Using `run.sh` to Check / Install Requirements

The launcher script already has helpers to check and install what it can.

### 4.1 Check system dependencies

```bash
./run.sh --check-deps
```

This will verify:

- Python 3
- `pkg-config`
- `curl`
- GTK 3 development libraries
- PyGObject for Python

### 4.2 Install Python GUI dependencies

The script can install the Python dependencies for the GTK GUI based on `gtk_gui_pro/requirements.txt`:

```bash
./run.sh --install-deps
```

or via the interactive menu option **Install requirements** (if available in the menu), which will:

- Check system dependencies
- Install/update Python packages required by the GUI

> **Note:** System‑level tools (Docker, Node.js, GTK libraries, etc.) still need to be installed using your OS package manager. The script will tell you what is missing and how to install it, but will not run `apt`/`pacman` for you.

---

## 5. Quick Checklist

To run the full ShieldEye SurfaceScan stack with GUI:

1. Install **Docker** and **docker compose**.
2. Install **Python 3.10+**, **GTK 3**, **PyGObject**, `curl`, `pkg-config`.
3. (Optional) Install **Node.js 18+** if you want to work on services outside Docker.
4. Copy `.env.example` → `.env` and adjust configuration.
5. Install Python GUI deps:
   - `./run.sh --install-deps`
6. Start the stack and GUI:
   - `./run.sh` and choose full stack (backend + API + GUI) or your preferred mode.
