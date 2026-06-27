# RxShield: Offline-First Local-Edge Clinical Safety Engine

**Live Deployment:** [rx-shield-phi.vercel.app](https://rx-shield-phi.vercel.app/)

RxShield is a hybrid, offline-first, mobile-optimized Progressive Web App (PWA) designed to intercept medication prescription errors at the point of dispensing in understaffed, power-unstable clinical settings (such as rural Nigerian hospitals). 

By default, the application runs a resilient, parallel-track orchestrator that races a cloud OCR track for maximum accuracy against an on-device WebAssembly (WASM) computer vision pipeline. When offline or under unstable network conditions, it falls back instantly to the local vision worker and its highly compressed, localized SQLite clinical rule engine. This allows frontline pharmacists and nurses to capture an image of a handwritten prescription, instantly extract drug names and dosages, and evaluate them against the official **Nigeria Standard Treatment Guidelines (NSTG)** and drug-drug interaction tables—completely without internet access or cloud server dependencies.

---

## 1. Key System Features & Latency Cap

1. **Zero-Connectivity Clinical Safety:** 100% local operation with no external API calls, servers, or database connections required after the initial load.
2. **Sub-Second Execution Matrix:** Consistently achieves a processing latency of **under 500ms** (typically ~350ms) from image shutter click to clinical alert rendering on mid-to-low-tier client devices.
3. **Resilient Parallel Race Orchestrator**: Races cloud OCR tracks against a tight `3000ms` defensive timeout. Under flaky or offline network profiles, the UI bypasses slow cloud pings instantly, falling back to local WASM OCR.
4. **Radical Data Compression:** Condenses global clinical datasets (10M+ OpenFDA entries) and localized medical guidelines (500+ pages of NSTG protocols) into a highly optimized SQLite database under **350KB** (well below the 25MB design ceiling).
5. **Zero Alert Fatigue Triage:** Utilizes a deterministic visual triage system that only interrupts clinicians when high-risk contraindications or severe drug-drug interactions are found:
   - **Tier 1 (Instant Pass - Green):** Dosage matches guidelines; no interactions.
   - **Tier 2 (Conditional Checklist - Amber):** Prompts the clinician with a target demographic checklist (e.g., pregnancy or renal status) for specific high-risk drugs.
   - **Tier 3 (Hard Block - Crimson):** Severe dosage or drug-drug interaction detected, displaying an explicit clinical alert with the exact NSTG page/chapter citation.
6. **Hardware-Friendly Static Shutter:** Eliminates continuous video stream parsing to prevent thermal throttling and battery drain on low-end tablets.

---

## 2. Monorepo Structural Boundaries

The workspace enforces strict structural boundaries to prevent dependency leakage between the development environments.

> [!CRITICAL]
> **Workspace Isolation Rules:**
> 1. **JavaScript Environment:** All node dependencies (`node_modules`) are strictly confined to `rxshield-web/`.
> 2. **Python Environment:** All Python virtual environments (`.venv`) are strictly confined to `rxshield-pipeline/`.
> 3. **Parent Root Restriction:** **Never** run `npm install`, `pnpm install`, or `pip install` at the parent root directory.
> 4. **No Binary Commit Policy:** Raw PDF documents, large ZIPs, model checkpoints (`.pth`), and unquantized ONNX models must never be committed to git. They are managed in `.gitignore`.

---

## 3. Directory Layout

```
RxShield/
├── .agents/                    # Developer agent configs & rules
├── rxshield-pipeline/          # Python data processing & ML compilation pipeline
│   ├── data/
│   │   ├── raw/                # Sourced reference PDFs, XLSX, and Zip files (Git ignored)
│   │   ├── processed/          # Normalized intermediate CSV data (Git ignored)
│   │   └── output/             # Final compiled database binaries (Git ignored)
│   ├── scripts/                # Sequential pipeline assembly scripts
│   ├── requirements.txt        # Python dependency manifest
│   └── best_model.pth          # Source handwriting recognition weights (Git ignored)
│
├── rxshield-web/               # Next.js Progressive Web App (PWA)
│   ├── public/                 # Static resources
│   │   ├── database/           # SQLite database asset (rxshield_core.db)
│   │   ├── models/             # Quantized ONNX character model (crnn_int8.onnx)
│   │   └── wasm/               # WebAssembly binaries for database & model execution
│   ├── src/
│   │   ├── components/         # Presentation Layer (Camera view, Dashboard, Alerts)
│   │   ├── services/           # Data & Computational Core Interfaces (dbService, ocrService)
│   │   ├── workers/            # Multi-Threaded Execution Layer (vision.worker.ts & db.worker.ts)
│   │   └── utils/              # Pure computational utilities (stringDistance)
│   ├── package.json            # Web project dependencies & build commands
│   └── DEPLOYMENT.md           # Static edge deployment and HTTP headers guide
```

---

## 4. Pipeline Assembly & Compilation (`rxshield-pipeline`)

The data pipeline consumes raw medical guidelines, Excel EML lists, and API data feeds, compiling them into the lightweight SQLite database and INT8-quantized ONNX character recognition model.

### Setup and Ingestion

1. **Initialize the Virtual Environment:**
   ```bash
   cd rxshield-pipeline
   python -m venv .venv
   # Activate on Windows:
   .venv\Scripts\activate
   # Activate on macOS/Linux:
   source .venv/bin/activate
   ```
2. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Place Seed Data:**
   Ensure your raw source datasets are available under `data/raw/` (e.g., `eml_export.xlsx` and `Nigeria Standard Treatment Guidelines 2022.pdf`).

### Sequential Execution Steps

Run the pipeline scripts in exact numerical order to clean files, extract protocols, compile the database, and quantize the model:

```bash
# 1. Ingest and normalize EML directory
python scripts/01_ingest_eml_directory.py

# 2. Fetch and aggregate openFDA adverse drug-drug interactions (Network Offline Safe)
python scripts/02_fetch_adverse_events.py

# 3. Rasterize and OCR NSTG PDF chapters (Tesseract Offline Safe)
python scripts/03_extract_nstg_protocols.py

# 4. Parse, normalize, and regularize raw text using EML cross-referencing (Highly Optimized)
python scripts/04_clean_and_validate_protocols.py

# 5. Compile processed CSV files into SQLite database
python scripts/05_compile_sqlite.py

# 6. Quantize PyTorch model weights to INT8 and compile ONNX binary
python scripts/06_export_edge_vision_model.py
```

*Note: Scripts 02 and 03 include built-in offline fallbacks that automatically reuse existing local csv and text files if internet access or Tesseract OCR is unavailable on the compilation machine.*

*Upon completion, the final compiled assets (`rxshield_core.db` and `crnn_int8.onnx`) are automatically copied into the `rxshield-web/public/` sub-directories.*

---

## 5. Web Client Application (`rxshield-web`)

The frontend application runs entirely inside the client's browser, utilizing multi-threaded Web Workers to keep the UI running at 60 FPS while executing vision inference and relational SQL queries.

### Setup & Local Development

1. **Ensure pnpm is Installed:**
   This project uses `pnpm` to manage node packages.
2. **Install Web Dependencies:**
   ```bash
   cd rxshield-web
   pnpm install
   ```
3. **Run the Development Server:**
   ```bash
   pnpm run dev
   ```
   Open `http://localhost:3000` to view the application in the browser.

### Multi-Threading & WASM Runtime Architecture

To avoid main-thread UI lag and browser thermal throttling:

1. **Camera Component** isolates a single captured viewport frame and converts it to a standard `Uint8ClampedArray` buffer.
2. The buffer is shipped across a thread boundary to `vision.worker.ts` (Web Worker) managed via **Comlink**.
3. The Web Worker executes the **INT8 ONNX model** via `@onnxruntime/web` using WebAssembly, caching intermediate runs to eliminate duplicate executions.
4. Extracted OCR strings are normalized by replacing slashes (`/`), hyphens (`-`), and spaces (`+`) to build a clean EML lookup token.
5. The normalized EML token is queried against the local **SQLite WASM Database** (`db.worker.ts`) using `@sqlite.org/sqlite-wasm` to check NSTG safety boundaries and drug-drug interactions.
6. Memory allocations in the WASM heap are protected from leaks using strict `try-finally` deallocations (`sqlite3.wasm.dealloc`).

---

## 6. Local Relational SQLite Schema

The local relational schema is optimized with separate indexing to prevent table scans:

### `drugs`
Maps local brand nomenclature to generic identifiers.
- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT)
- `brand_name` (TEXT) - *Indexed via `idx_drugs_brand`*
- `generic_name` (TEXT) - *Indexed via `idx_drugs_generic`*
- `atc_code` (TEXT)

### `nstg_protocols`
Dosage thresholds, treatment duration, and demographic checking rules translated from Nigeria Standard Treatment Guidelines.
- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT)
- `generic_name` (TEXT, UNIQUE)
- `max_single_dose_mg` (REAL)
- `max_daily_dose_mg` (REAL)
- `max_duration_days` (INTEGER)
- `requires_pregnancy_check` (INTEGER)
- `requires_renal_check` (INTEGER)
- `guideline_citation` (TEXT)

### `drug_interactions`
The adverse interaction combinations matrix compiled from openFDA logs.
- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT)
- `atc_code_a` (TEXT) - *Indexed via `idx_interactions_lookup`*
- `atc_code_b` (TEXT) - *Indexed via `idx_interactions_lookup`*
- `severity` (TEXT)
- `risk_description` (TEXT)

---

## 7. Edge Deployment & HTTP Headers Policy

Because the application loads multi-threaded WebAssembly in the browser (via SQLite WASM and ONNX Web WASM), modern browsers require strict security headers:
- **Cross-Origin Opener Policy (COOP):** `same-origin`
- **Cross-Origin Embedder Policy (COEP):** `require-corp`

### Production Compilation
Static export is used for edge hosting:
```bash
pnpm run build
```
This exports the static files into `rxshield-web/out/`. The build size is verified under the **45MB** hard ceiling (typically ~41MB, including database and models), with 98 static assets automatically injected for service worker precaching.

### Hosting Configurations

Ensure your static host is configured to serve the required headers:

#### Vercel (`vercel.json`)
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        },
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "require-corp"
        }
      ]
    }
  ]
}
```

#### Cloudflare Pages (`_headers`)
Create a `_headers` file in `public/` (copied to `out/`):
```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

#### Netlify (`netlify.toml`)
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

For custom web servers like **Nginx**, add the headers directly to the server block in your `nginx.conf`:
```nginx
add_header Cross-Origin-Opener-Policy "same-origin";
add_header Cross-Origin-Embedder-Policy "require-corp";
```

---

## 8. Clinical UI System Tokens

To ensure maximum contrast under direct clinic lighting and poor tablet screen panels, the application uses a **Force-Baked Light Mode** styling scheme matching these semantic tokens:

- **Pass (Tier 1):** Solid Green (`bg-green-600` / `#16A34A`), text white.
- **Conditional (Tier 2):** Solid Amber (`bg-amber-500` / `#F59E0B`), text black.
- **Danger Block (Tier 3):** Solid Crimson (`bg-rose-700` / `#BE123C`), text white.
- **AI Processing Indicator:** Solid Blue (`bg-blue-600` / `#2563EB`) with a light blue track animation.
- **Typography:** Highly legible sans-serif for structures, monospace fonts (e.g. `font-mono`) for exact dosage numbers (`625mg`) and database references.
