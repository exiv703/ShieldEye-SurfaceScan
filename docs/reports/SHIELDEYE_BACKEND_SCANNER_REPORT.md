# Raport techniczny: ShieldEye – Enhancment Backend Scanner

## 1. Cel dokumentu

Ten dokument ma wprowadzić nowego członka zespołu (lub agenta) w projekt **ShieldEye** i bardzo konkretnie wyjaśnić:

- czym jest ShieldEye i jak działa jako system,
- jak wygląda przepływ skanu end‑to‑end,
- jaką ma architekturę (API, Analyzer, GUI, baza, kolejki),
- **jakie dokładnie zmiany zostały wykonane w ramach prac opisanych w rozmowie „Enhance Backend Scanner”**.

Założenie: czytelnik widzi repozytorium i kod, ale nie zna historii projektu ani kontekstu technicznego. Po przeczytaniu tego raportu powinien czuć się jak pełnoprawny członek zespołu.

---

## 2. Ogólny obraz: co robi ShieldEye

ShieldEye to platforma do **analizy bezpieczeństwa aplikacji webowych**.

W praktyce:

- Użytkownik podaje **URL** strony.
- System:
  - pobiera stronę i powiązane zasoby (renderer/analyzer),
  - analizuje **JavaScript** (inline i external) pod kątem wzorców niebezpiecznych,
  - identyfikuje biblioteki JS (np. z CDN, node_modules, itp.),
  - odpytuje zewnętrzne feedy podatności (głównie **OSV**),
  - liczy **globalny poziom ryzyka** (`global_risk_score` 0–100),
  - generuje listę *findings* (problemy bezpieczeństwa, misconfigi, podatności),
  - udostępnia wyniki w GUI i API,
  - opcjonalnie generuje zaawansowane raporty z użyciem AI (LLM) i dodatkowych analiz (supply chain, blockchain, quantum readiness – głównie w pełnym analyzerze).

Użytkownik ma do dyspozycji:

- **desktopową aplikację GTK** (`gtk_gui_pro`) – główny interfejs w tej sesji,
- API (REST) – możliwe użycie przez inne systemy i frontend webowy.

---

## 3. Architektura systemu

### 3.1. Mikroserwisy (Docker Compose)

Plik: `docker-compose.yml`.

Kluczowe serwisy:

- **postgres**
  - Baza `shieldeye`.
  - Trzyma:
    - `scans` – skany,
    - `libraries` – wykryte biblioteki,
    - `findings` – znaleziska,
    - `scripts` – skrypty JS,
    - `vulnerability_cache` – cache odpowiedzi OSV,
    - kilka dodatkowych tabel dla zaawansowanych raportów (AI, supply chain, quantum, analytics_reports itp.).

- **redis**
  - Głównie jako backend dla kolejek (Bull) i ewentualny cache.

- **minio**
  - S3‑kompatybilny storage artefaktów (DOM snapshoty, network trace, skrypty JS itp.).

- **api**
  - Aplikacja Node/Express (`api/`).
  - Odpowiada za:
    - rejestrowanie skanów,
    - their status i listowanie,
    - zwracanie wyników skanów (minimum analyzer),
    - endpointy health/metrics,
    - analytics (`/api/analytics/summary`),
    - prosty endpoint kolejki (`/api/queue/stats`),
    - **proxy do LLM/AI** (`/api/ai/llm/generate`).

- **analyzer**
  - Serwis Node/TS (`analyzer/src/worker.ts`), główny pełny **AnalysisWorker**.
  - Konsumuje jobs z kolejki (`analysis-queue`), czyta dane z MinIO, wykonuje zaawansowaną analizę bezpieczeństwa, zapisuje wyniki do Postgresa.

- **renderer**
  - Renderowanie raportów (np. generowanie artefaktów, snapshotów itp.).

- **frontend**
  - Webowy frontend (React). W ramach tej sesji raczej nie był głównym kanałem interakcji, bo używaliśmy GUI GTK.

Ważna zmiana w tej sesji:

- W serwisie **api** dodano:

  ```yaml
  extra_hosts:
    - "host.docker.internal:host-gateway"
  ```

  Dzięki temu API (w kontenerze) może mówić z **Ollama LLM** działającym na hoście (port 11434).

---

### 3.2. Warstwa współdzielona – `shared/`

Pliki kluczowe:

- `shared/src/types.ts`
- `shared/src/utils.ts`

#### 3.2.1. Typy (`types.ts`)

- `RiskLevel` – poziomy ryzyka: `low`, `moderate`, `high`, `critical`.
- `FindingType` – typy znalezisk, m.in.:
  - `EVAL_USAGE`, `HARDCODED_TOKEN`, `DYNAMIC_IMPORT`, `WEBASSEMBLY`,
  - `CVE`, `REMOTE_CODE`, `AI_THREAT`, `BLOCKCHAIN_INTEGRITY`, `SUPPLY_CHAIN_ATTACK`, `QUANTUM_VULNERABILITY`, `BEHAVIORAL_ANOMALY`.
- `ScanStatus` – `pending`, `running`, `completed`, `failed`.
- `Scan`, `Library`, `Vulnerability`, `Finding`, `Script`, `ScanTask`, `TaskResult`.
- `DOMAnalysis`, `NetworkResource` – opis struktury DOM i zasobów sieciowych.
- `ScanRequestSchema` (zod) – walidacja wejścia dla API.

#### 3.2.2. Narzędzia (`utils.ts`)

- **RiskCalculator**:
  - `calculateLibraryRisk(...)` – liczy ryzyko biblioteki z CVSS, confidence i informacją o publicznych exploitach.
  - `calculateGlobalRisk(libraryRisks, criticalFindings)` – z listy riskScore bibliotek + liczby krytycznych findings wyciąga globalny wynik 0–100.
  - `getRiskLevel(score)` – mapowanie na `RiskLevel`.

- **PatternUtils**:
  - `detectRiskyPatterns(content: string)` – linia po linii znajduje wzorce:
    - `eval(...)`,
    - hardcoded secrets/tokens,
    - dynamic imports,
    - WebAssembly.

- Pozostałe: `VersionUtils`, `FingerprintUtils`, `CacheUtils`, `EnhancedValidationUtils`, `PerformanceUtils`, `RetryUtils` – wykorzystywane głównie w analyzerze i API.

---

### 3.3. Warstwa DB – `api/src/database.ts`

Klasa `Database` opakowuje pulę połączeń do Postgresa i zapewnia:

- zarządzanie połączeniami,
- health‑checki puli,
- retry z exponential backoff,
- transakcje (`withTransaction`).

Tabela `scans` (z uproszczeniem):

- `id` (UUID), `url`, `metadata` (parametry skanu),
- `status`,
- `created_at`, `started_at`, `completed_at`,
- `global_risk_score`,
- `artifact_paths`,
- `error`.

Tabela `scripts`:

- `id`, `scan_id`, `source_url`, `is_inline`,
- `artifact_path`, `fingerprint`,
- `detected_patterns`, `estimated_version`, `confidence`.

Tabela `libraries`:

- `id`, `scan_id`, `name`, `detected_version`,
- `related_scripts`, `vulnerabilities` (JSON), `risk_score`, `confidence`.

Tabela `findings`:

- `id`, `scan_id`, `type`, `title`, `description`, `severity`, `location` (JSON), `evidence`.

Tabela `vulnerability_cache`:

- `package_name`, `version`, `vulnerabilities` (JSON), `last_updated`, `ttl`.

Dodatkowe tabele (częściowo używane przez pełny analyzer):

- `ai_analysis`, `integrity_reports`, `supply_chain_analysis`, `quantum_readiness`, `analytics_reports` itd.

**Nowe/kluczowe metody, z których korzysta analytics/dashboard:**

- `getScansCount()` – liczba skanów,
- `getAverageRiskScore()` – średni `global_risk_score`,
- `getLibrariesCount()` – liczba bibliotek,
- `getTotalFindingsCount()` – liczba wszystkich findings,
- `getFindingsSeverityCounts()` – liczba findings per severity,
- `getTopVulnerabilities(limit)` – top N findings pogrupowanych po tytuł/severity.

---

### 3.4. Desktopowa aplikacja GTK – `gtk_gui_pro`

To jest główny interfejs użytkownika w tej sesji.

#### 3.4.1. Launcher – `run.sh`

Interaktywny skrypt uruchamiający z menu:

1. **Full stack (backend + API + GUI)**
2. GUI only
3. Backend services only
4. API only
5. **Reset analytics data (truncate DB)** – *dodane w ramach tej sesji*
6. Exit

Najważniejsze funkcje:

- `check_dependencies()` – weryfikuje Python 3, GTK, PyGObject.
- `setup_environment()` – ustawia `SHIELDEYE_API_URL`, `GTK_THEME`, `PYTHONPATH`.
- `check_api_connection()` – sprawdza `/health`, jeśli trzeba – odpala backend poprzez `docker compose up -d postgres redis minio api renderer analyzer`.
- `launch_application()` – odpala `python3 main.py`.
- `reset_demo_data()` – **istotne**:
  - pyta użytkownika o potwierdzenie,
  - jeśli Docker dostępny, wykonuje w kontenerze Postgresa:

    ```sql
    TRUNCATE TABLE findings, libraries, scripts, vulnerability_cache, scans
    RESTART IDENTITY CASCADE;
    ```

  - efekt: dashboard i analytics zaczynają liczyć statystyki **od zera** (przydatne w demo/labie).

#### 3.4.2. `MainWindow` – `src/ui/main_window.py`

Główne okno aplikacji:

- trzyma referencje do:
  - `api_client` (instancja `APIClient`),
  - `settings`, `logger`,
  - widoków: `dashboard`, `scan`, `results`, `analytics`, `injection`, `hardening`, `settings`.

Kluczowe elementy:

- `start_scan(scan_request)` → `_perform_scan`:
  - tworzy skan via `APIClient.create_scan`,
  - zapisuje `current_scan_id`,
  - przełącza widok na `scan`,
  - uruchamia polling statusu (`_poll_scan_status`).

- `_poll_scan_status()`:
  - cyklicznie woła `/api/scans/:id/status`,
  - aktualizuje widok ScanView (`update_scan_status`),
  - **po naszych zmianach**:
    - gdy status ∈ {`completed`, `failed`}:
      - zatrzymuje polling,
      - dla `completed` → `_load_scan_results()` (pobiera `/api/scans/:id/results`),
      - dla `failed` → pokazuje błąd,
      - oraz (nowość):
        - wykonuje `dashboard_view.refresh()` i `analytics_view.refresh()` przez `GLib.idle_add`.

  Efekt: dashboard i analytics **same się odświeżają po zakończonym skanie**, bez ręcznego klikania „Refresh”.

- `_load_scan_results()` + `_display_results()`:
  - pobierają wyniki z `/api/scans/:id/results` (minimal analyzer w API),
  - przekazują results do `ResultsView.display_results`,
  - pokazują powiadomienie o ukończonym skanie (URL + risk score).

#### 3.4.3. `APIClient` – `src/services/api_client.py`

Profesjonalny klient HTTP do API (requests + retry + cache).

Najważniejsze metody:

- `get_health()`, `test_connection()`, `get_ready()`.
- `create_scan()`, `get_scan_status()`, `get_scan_results()`, `get_scan_list()`, `delete_scan()`.
- `get_queue_stats()`.
- `get_analytics_summary()` – **zmiana w tej sesji**:
  - wcześniejsza wersja cache’owała odpowiedź,
  - teraz **cache jest wyłączony**, metoda zawsze robi świeże `GET /api/analytics/summary`.
- `generate_ai_analysis()` – endpointy AI (najpierw `/api/ai/llm/generate`, potem fallback na starsze / alternatywne jeśli 404).

Cache nadal jest wykorzystywany np. dla:

- `/health`,
- `/api/scans/:id/results` (wyniki skanu są w praktyce statyczne, więc można je cache’ować długo),
- `/api/queue/stats` (krótki TTL).

#### 3.4.4. `DashboardView` – `src/ui/views/dashboard_view.py`

Widok „Security Dashboard” zawiera:

- metric cards:
  - `Total Scans`, `Active Threats`, `Vulnerabilities`, `Avg Risk Score`,
- wykresy:
  - `Vulnerability Trends` (line),
  - `Risk Distribution` (donut),
- widgety aktywności (`RecentScansWidget`, `ThreatOverviewWidget`).

`refresh()`:

- asynchronicznie woła `get_analytics_summary()`,
- aktualizuje:
  - ilość skanów,
  - liczby zagrożeń,
  - średni risk score (tekstowo np. „High Risk” przy wysokiej wartości),
  - wykres rozkładu ryzyka.

`on_view_activated()` – jeśli dane starsze niż 5 min, wykonuje `refresh()`.

#### 3.4.5. `AnalyticsView` – `src/ui/views/analytics_view.py`

Prostszy widok podsumowania z przyciskiem „Refresh”.

- Pokazuje:
  - `Total Scans`,
  - `Vulnerabilities`,
  - `Active Threats`,
  - `Avg Risk Score`.

`refresh()`:

- asynchronicznie wywołuje `get_analytics_summary()`,
- mapuje różne możliwe pola z odpowiedzi API (`totalScans`, `totalVulnerabilities`, `activeThreats`, `avgRiskScore` lub starsze pola),
- aktualizuje etykiety.

#### 3.4.6. `ResultsView` – `src/ui/views/results_view.py`

Widok wyników pojedynczego skanu.

Główne elementy:

- nagłówek `Scan Results`, przycisk `AI Analysis`.
- sekcja „summary” (URL, risk score, liczby bibliotek i findings).
- listy:
  - bibliotek (`Libraries`),
  - findings (`Findings`).

Po tej sesji:

- biblioteki są sortowane wg:
  - `riskScore` malejąco,
  - liczby podatności (descending) jako drugi klucz.
- findings są sortowane wg `severity` (critical > high > moderate/medium > low).

**AI Analysis** (`_on_ai_analysis`):

- Przygotowuje kontekst:
  - z `scan` (URL, `globalRiskScore`),
  - z `summary` (statystyki z backendu),
  - z bibliotek (`name`, `version`, `risk` – top 20),
  - z findings (top 20, skrócone opisy).
- Buduje prompt proszący o:
  - **szczegółowy raport bezpieczeństwa**,
  - priorytetyzację działań naprawczych.
- Wywołuje `APIClient.generate_ai_analysis()` z tym kontekstem.
- Wyświetla odpowiedź (tekst) w panelu AI.

---

## 4. Przepływ skanu end‑to‑end

### 4.1. Start środowiska

1. Z poziomu `gtk_gui_pro/`:

   ```bash
   ./run.sh
   # wybierz 1) Full stack (backend + API + GUI)
   ```

2. Skrypt:
   - sprawdza zależności (Python, GTK, PyGObject),
   - ustawia env (`SHIELDEYE_API_URL` = `http://localhost:3000`),
   - jeśli `/health` nie działa → startuje backend przez Docker Compose.

3. Następnie uruchamia `python3 main.py` (GUI `ShieldEye Professional`).

### 4.2. Utworzenie skanu (GUI → API)

W GUI użytkownik wprowadza URL, parametry skanu i zatwierdza.

- `MainWindow.start_scan()` tworzy `ScanRequest`,
- `APIClient.create_scan()` wysyła `POST /api/scans` z JSON w stylu:

  ```json
  {
    "url": "https://example.com/",
    "renderJavaScript": true,
    "timeout": 30000,
    "crawlDepth": 1,
    "scanType": "comprehensive"
  }
  ```

- API (`minimal-api.ts`):
  - waliduje (w oparciu o `ScanRequestSchema`),
  - tworzy rekord w `scans` (status `pending`, `global_risk_score = 0`),
  - wrzuca job do kolejki (`TaskQueue.addScanJob`).

- GUI zapisuje `current_scan_id` i startuje polling statusu (`_poll_scan_status`).

### 4.3. Przetwarzanie skanu (analyzer)

Serwis `analyzer` (AnalysisWorker):

- pobiera joby z kolejki Bull (`analysis-queue`),
- używa DOMAnalysis, artefaktów z MinIO itd.,
- wykrywa biblioteki, podatności z feedów (OSV, NVD),
- liczy zaawansowany globalny risk score (AdvancedRiskCalculator),
- generuje raporty AI, supply chain, quantum readiness,
- zapisuje wszystko do Postgresa (tabele `scripts`, `libraries`, `findings`, `ai_analysis`, `integrity_reports`, `supply_chain_analysis`, `quantum_readiness`, `analytics_reports`).

W tej sesji ta część była głównie **punktem odniesienia** – nie robiliśmy masy zmian w `AnalysisWorker`, tylko upewnialiśmy się, że **minimalny analyzer w API** jest sensowniejszy.

### 4.4. Polling statusu i ładowanie wyników (GUI)

`MainWindow._poll_scan_status()`:

- co kilka sekund woła `/api/scans/:id/status` przez `APIClient.get_scan_status`.
- Aktualizuje ScanView: status, progress.
- Gdy status to `completed` lub `failed`:
  - zatrzymuje polling,
  - **dla `completed`** → `_load_scan_results()` (pobiera `/api/scans/:id/results`),
  - **dla `failed`** → pokazuje błąd,
  - **oraz wykonuje auto‑refresh dashboardu i analytics** (nasza nowa funkcja).

### 4.5. Minimalny analyzer w API (`/api/scans/:id/results`)

Gdy GUI pierwszy raz wejdzie w Results danego skanu, API:

1. Pobiera skan z DB.
2. Woła `minimalAnalyzeAndPersist(scan)` (nasza rozbudowana funkcja w `minimal-api.ts`).
3. Zwraca wynik w formie `ScanResultResponse`:

   - `scan`,
   - `libraries`,
   - `findings`,
   - `summary` (liczby bibliotek, podatności, distribution, critical findings).

Ważne: minimalny analyzer działa **lazy** – jeśli dla danego skanu nie ma jeszcze danych w DB, wykonuje analizę i zapisuje; jeśli już są (np. z pełnego analyzer’a) – używa istniejących.

---

## 5. Zmiany wykonane w ramach „Enhance Backend Scanner” – sedno

### 5.1. Rozszerzenie minimalnego skanera w API (`api/src/minimal-api.ts`)

#### 5.1.1. Importy i konfiguracja

- Rozszerzony import z `@shieldeye/shared` o:
  - `PatternUtils`, `FindingType`, `RiskCalculator`.
- Dodane stałe konfiguracyjne dla OSV (`OSV_API_URL`, `OSV_TIMEOUT_MS`).
- Dodane stałe dla LLM (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TEMPERATURE`, `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS`).

#### 5.1.2. Pobieranie HTML i nagłówków

Funkcja `fetchHtml(url)` teraz:

- używa `fetch` z `AbortController` (timeout 15s),
- oprócz `html` zwraca także:
  - `headers` jako mapę `key -> value`,
  - `status` HTTP.

Te nagłówki są później analizowane pod kątem bezpieczeństwa.

#### 5.1.3. Ekstrakcja inline skryptów

- Funkcja `extractInlineScripts(html)` wyciąga `<script>` bez atrybutu `src`.
- Limit 20 skryptów (żeby zachować minimalizm i nie zabijać wydajności).

#### 5.1.4. Mapowanie `FindingType` → `RiskLevel`

- Funkcja `mapFindingTypeToSeverity(type: FindingType): RiskLevel` – centralne miejsce, gdzie typ znaleziska jest tłumaczony na severity (`low`, `moderate`, `high`, `critical`).

#### 5.1.5. Analiza inline JS z użyciem `PatternUtils`

W `minimalAnalyzeAndPersist`:

- dla każdego inline scriptu:
  - wywołanie `PatternUtils.detectRiskyPatterns(scriptContent)`,
  - dla każdego wyniku tworzymy `Finding` z:
    - `type` = `FindingType` z PatternUtils,
    - `severity` z `mapFindingTypeToSeverity`,
    - opisem „Script security pattern detected”,
    - location (inline, index, linia),
    - evidence (np. fragment linii).

To dało minimalnemu analyzerowi **prawdziwą zdolność wykrywania klasycznych anty‑patternów JS**.

#### 5.1.6. Analiza nagłówków bezpieczeństwa HTTP

Z pobranych `responseHeaders` tworzymy mapę `headers` w lower‑case i sprawdzamy:

- `Content-Security-Policy` (CSP):
  - brak → finding „Missing Content-Security-Policy header”, severity `moderate`.
  - obecność `unsafe-inline`/`unsafe-eval` → finding „Weak CSP”, severity `high`.

- `Strict-Transport-Security` (HSTS):
  - dla HTTPS, brak HSTS → finding „Missing HSTS header”, severity `high`.

- `X-Frame-Options`:
  - brak → finding „Missing X-Frame-Options”, severity `moderate`.
  - niestandardowa wartość → „Weak X-Frame-Options configuration”.

- `X-Content-Type-Options`:
  - brak lub wartość różna od `nosniff` → finding „Missing or weak X-Content-Type-Options header”, severity `moderate`.

#### 5.1.7. Analiza ciasteczek (Set-Cookie)

- Odczytuje nagłówek `Set-Cookie` (wielokrotne wiersze).
- Dla każdego ciasteczka:
  - wykrywa, czy nazwa sugeruje sesję/auth (`session`, `auth`, `token`, `jwt`),
  - sprawdza obecność flag:
    - `Secure`,
    - `HttpOnly`,
    - `SameSite`.

- Tworzone findings:
  - „Sensitive session/auth cookie missing security flags” (high),
  - „Cookie missing Secure/HttpOnly flags” (moderate).

#### 5.1.8. Analiza zewnętrznych skryptów i SRI

Dla `script src="..."`:

- rozpoznaje:
  - nazwę biblioteki na podstawie ścieżki (CDNJS patterns, `name-version.js`, itp.),
  - wersję (o ile da się wyciągnąć),
  - czy skrypt jest third‑party (host ≠ host strony),
  - czy jest ładowany po HTTP (insecure) czy HTTPS,
  - czy ma atrybut `integrity` (Subresource Integrity).

- Tworzy obiekty `Library` z:
  - `riskScore` bazując na heurystyce (third‑party + insecure → większe ryzyko).

- Dodaliśmy też **findingi dot. SRI**:
  - jeśli skrypt jest third‑party, po HTTPS, bez `integrity` → finding „Missing Subresource Integrity (SRI) for third-party script”, severity `moderate`.

#### 5.1.9. Integracja z OSV (CVE)

Funkcja `fetchLibraryVulnerabilitiesFromOsv(name, version?)`:

- wysyła `POST` do `OSV_API_URL/v1/query` z:

  ```json
  {
    "package": { "name": "<lib>", "ecosystem": "npm" },
    "version": "x.y.z" // opcjonalnie
  }
  ```

- pobiera listę `vulns` (ID, summary, details, severity, references).
- tnie listę do max 20.

Dla każdej biblioteki:

- wzbogacamy jej `vulnerabilities` na podstawie OSV (tworząc obiekty `Vulnerability` o severity CRITICAL/HIGH/MEDIUM/LOW),
- obliczamy risk score poprzez `RiskCalculator.calculateLibraryRisk`:
  - wejścia to lista `{ cvssScore?, severity }`, confidence, ewentualne `hasPublicExploit`.
- riskScore jest zaokrąglany do 0–100.

Efekt: nawet bez pełnego analyzer’a, minimalny backend potrafi znaleźć **konkretne CVE** w znanych bibliotekach.

#### 5.1.10. Podsumowanie analiz i globalny risk score

Na koniec minimalnej analizy:

- Tworzymy `summaryFinding` (INFO) o liczbie wykrytych skryptów.
- Tworzymy `thirdPartyFinding` i `insecureFinding` (INFO/HIGH) z liczbą skryptów third‑party i HTTP.
- Liczymy **globalny risk score** skanu:

  - `libraryRisks = libraries.map(lib => lib.riskScore || 0)`,
  - `criticalFindings = findings.filter(f => severity == CRITICAL).length`.
  - `globalRisk = RiskCalculator.calculateGlobalRisk(libraryRisks, criticalFindings)`.
  - Zapisujemy do DB przez `database.updateScanRiskScore(scan.id, globalRisk)`.

To jest teraz spójne źródło dla `scan.globalRiskScore` wykorzystywanego w GUI.

---

### 5.2. Endpoint AI / LLM – `/api/ai/llm/generate`

W `minimal-api.ts` dodaliśmy **pełny endpoint AI**:

- `POST /api/ai/llm/generate`:
  - wymagany `prompt` (string, max długość),
  - opcjonalny `system` prompt,
  - parametry generacji (`temperature`, `max_tokens`),
  - **`context`** – dowolny JSON (np. summary skanu, biblioteki, findings).

Backend:

- buduje zapytanie do LLM (domyślnie **Ollama**):
  - `LLM_PROVIDER='ollama'`,
  - `LLM_BASE_URL='http://localhost:11434'` (dzięki `extra_hosts` w docker-compose),
  - `LLM_MODEL` konfigurowalny environmentem.
- konstruuje prompt zawierający opis zadania + serializowany `context` w JSON,
- robi `fetchWithTimeout` do LLM,
- zwraca odpowiedź do klienta (w prostym formacie tekstowym / JSON – ResultsView potrafi odczytać `output` albo `text`).

GUI:

- `APIClient.generate_ai_analysis()` najpierw woła ten endpoint,
- jeśli 404 → próbuje starszych (`/api/ai/generate`, `/api/ai/analyze`).

Ta zmiana „zaspawała” dziurę 404 z wcześniejszej iteracji, dzięki czemu przycisk „AI Analysis” w ResultsView faktycznie działa.

---

### 5.3. Analytics i dashboard

#### 5.3.1. Endpoint `/api/analytics/summary`

Na końcu `minimal-api.ts` jest nowy, główny endpoint analityczny:

- `GET /api/analytics/summary`:

  - pobiera z DB równolegle:
    - licznik bibliotek,
    - łączną liczbę findings,
    - rozkład severity (`getFindingsSeverityCounts`),
    - `totalScans`,
    - `averageRiskScore`,
    - top vulnerabilities.

  - z tego buduje payload m.in.:

    ```json
    {
      "totalScans": <int>,
      "scansChange": 0,
      "activeThreats": <liczba CRITICAL>,
      "threatsChange": 0,
      "totalVulnerabilities": <int>,
      "vulnerabilitiesChange": 0,
      "averageRiskScore": <float>,
      "avgRiskScore": <float>,
      "riskDistribution": {
        "critical": ..., "high": ..., "medium": ..., "low": ...
      },
      "vulnerabilityTrends": [],

      "libraries_analyzed": <int>,
      "total_vulnerabilities": <int>,
      "ai_threats_detected": <int>,
      "blockchain_verifications": 0,
      "vulnerability_breakdown": {...},
      "top_vulnerabilities": [...]
    }
    ```

- `DashboardView` i `AnalyticsView` korzystają z tych pól.

#### 5.3.2. Naprawa zera na dashboardzie

W trakcie pracy:

- Początkowo dashboard pokazywał 0 skanów, 0 vulnerabilities, 0 avg risk.
- Przyczyny:
  1. API w kontenerze nie było przebudowane po zmianach (stare pole JSON).
  2. Nawet po przebudowie: `APIClient.get_analytics_summary()` korzystał z **cache**, zapamiętując stare dane.

Rozwiązania wdrożone:

- Zrobiliśmy pełny **rebuild i restart API**.
- W `APIClient.get_analytics_summary()` **usunęliśmy logikę cache** – każde wywołanie robi nowe zapytanie do API.
- Dodatkowo wytłumaczyliśmy, że minimalny analyzer zapisuje findings i risk dopiero przy pierwszym wejściu w Results (ważne dla interpretacji statystyk).

#### 5.3.3. Reset historii analytics przez `run.sh`

Na Twoją prośbę dodaliśmy funkcję „wyczyszczenia historii”:

- `reset_demo_data()` w `run.sh`:
  - `TRUNCATE TABLE findings, libraries, scripts, vulnerability_cache, scans RESTART IDENTITY CASCADE;`
- UI: opcja `5) Reset analytics data (truncate DB)` w menu.
- Po wyczyszczeniu i nowych skanach dashboard/analytics liczą dane tylko na podstawie nowych wpisów.

---

### 5.4. Zmiany w GUI – Results, Dashboard, Analytics, auto‑refresh

#### 5.4.1. `ResultsView`

- Sortowanie bibliotek po `riskScore` i liczbie podatności.
- Sortowanie findings po severity.
- Przygotowanie rozsądnego kontekstu dla AI na bazie:
  - top bibliotek,
  - top findings,
  - summary,
  - globalRiskScore.

#### 5.4.2. `DashboardView`

- W pełni korzysta z nowych pól `/api/analytics/summary`:
  - `totalScans`, `totalVulnerabilities`, `activeThreats`, `averageRiskScore`, `riskDistribution`.

#### 5.4.3. `AnalyticsView`

- Pokazuje te same kluczowe liczby co dashboard, w prostszej formie.
- `refresh()` wywoływany także przy aktywacji widoku.

#### 5.4.4. Auto‑refresh po zakończonym skanie – `MainWindow`

Najbardziej widoczna zmiana UX:

- Po zmianie statusu skanu na `completed` lub `failed`, kod wywołuje:

  ```python
  dashboard_view = self.views.get('dashboard')
  if dashboard_view and hasattr(dashboard_view, 'refresh'):
      GLib.idle_add(dashboard_view.refresh)

  analytics_view = self.views.get('analytics')
  if analytics_view and hasattr(analytics_view, 'refresh'):
      GLib.idle_add(analytics_view.refresh)
  ```

- Użytkownik po skanie może przejść od razu na Dashboard/Analytics i zobaczyć aktualne dane, **bez ręcznego odświeżania**.

---

## 6. Health & Monitoring

Plik: `api/src/routes/health.ts`.

- `/health` – pełny health check (DB, queue, itp.).
- `/ready`, `/live` – readiness / liveness do orkiestracji.
- `/metrics` – bardziej szczegółowe metryki.
- `/queue/stats`, `/queue/health`, `/queue/dead-letter` – stan kolejki.
- `/database/health` – aktualny stan puli DB.

`run.sh` przy starcie full stack używa `/health` do sprawdzania, czy API w ogóle działa.

---

## 7. Jak wejść w projekt jako nowy członek zespołu

### 7.1. Minimalny checklist

1. **Uruchom środowisko**:

   ```bash
   cd /path/to/shieldeye/gtk_gui_pro
   ./run.sh
   # wybierz 1) Full stack
   ```

2. **Zrób skan testowy** z GUI.
3. **Wejdź w Results** skanu (żeby minimalny analyzer się uruchomił i zapisał findings).
4. Sprawdź **Dashboard** i **Analytics** – metryki powinny się zaktualizować automatycznie.
5. Jeśli chcesz lab/clean start, użyj z launchera opcji `5) Reset analytics data`.

### 7.2. Gdzie czego szukać w kodzie

- Backend API:
  - definicja endpointów + minimalny analyzer → `api/src/minimal-api.ts`.
  - operacje na DB → `api/src/database.ts`.
  - health/queue/metrics → `api/src/routes/health.ts`.

- Pełny analyzer:
  - worker kolejki, OSV/NVD, AI, blockchain, quantum → `analyzer/src/worker.ts`.

- Warstwa współdzielona:
  - typy → `shared/src/types.ts`.
  - utilsy (RiskCalculator, PatternUtils, itp.) → `shared/src/utils.ts`.

- GUI GTK:
  - główne okno → `gtk_gui_pro/src/ui/main_window.py`.
  - klient API → `gtk_gui_pro/src/services/api_client.py`.
  - dashboard → `gtk_gui_pro/src/ui/views/dashboard_view.py`.
  - analytics → `gtk_gui_pro/src/ui/views/analytics_view.py`.
  - wyniki skanu + AI → `gtk_gui_pro/src/ui/views/results_view.py`.
  - launcher → `gtk_gui_pro/run.sh`.

---

## 8. Podsumowanie

W ramach prac opisanych w rozmowie „Enhance Backend Scanner” projekt ShieldEye przeszedł z trybu „prosty skaner” do **pełnoprawnego, spójnego rozwiązania** z następującymi cechami:

- **Backend**:
  - minimalny analyzer w API jest znacznie mądrzejszy (PatternUtils, OSV, nagłówki HTTP, ciasteczka, SRI, risk scoring),
  - endpoint `/api/analytics/summary` dostarcza kompletne dane dla dashboardu i analytics,
  - endpoint `/api/ai/llm/generate` umożliwia pełną integrację z LLM (Ollama).

- **GUI**:
  - `ResultsView` pokazuje wyniki w przejrzysty sposób i potrafi wysłać sensowny kontekst do AI,
  - `DashboardView` i `AnalyticsView` korzystają z nowych metryk,
  - mechanizm caching został poprawnie wyłączony tam, gdzie przeszkadzał (analytics),
  - po każdym ukończonym skanie dashboard i analytics odświeżają się automatycznie.

- **Dev UX**:
  - launcher `run.sh` umożliwia szybki start/stop całego stacku i reset danych demo jednym wyborem w menu.

Nowy członek zespołu, mając ten raport + wgląd w kod, jest w stanie:

- zrozumieć strukturę projektu,
- ogarnąć przepływ skanu od GUI przez API, kolejkę, analyzer, DB, aż po analytics,
- bezpiecznie modyfikować backendowy skaner, wyniki i metryki, wiedząc, gdzie są ich punkty wejścia i powiązania.
