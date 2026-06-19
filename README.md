# RxShield: Offline-First Local-Edge Clinical Safety Engine

RxShield is an offline-first, mobile-optimized Progressive Web App (PWA) designed to intercept medication prescription errors at the point of dispensing in understaffed, power-unstable clinical settings (such as rural Nigerian hospitals). 

By combining an on-device WebAssembly (WASM) computer vision pipeline with a highly compressed, localized SQLite clinical rule engine, the application allows frontline pharmacists and nurses to capture an image of a handwritten prescription, instantly extract drug names and dosages, and evaluate them against the official **Nigeria Standard Treatment Guidelines (NSTG)** and drug-drug interaction tables—completely without internet access or cloud server dependencies.

---

## 1. Key System Features & Latency Cap

1. **Zero-Connectivity Clinical Safety:** 100% local operation with no external API calls, servers, or database connections required after the initial load.
2. **Sub-Second Execution Matrix:** Consistently achieves a latency of **under 1,000ms** from image shutter click to clinical alert rendering on mid-to-low-tier client devices.
3. **Radical Data Compression:** Condenses global clinical datasets (10M+ OpenFDA entries) and localized medical texts (500+ pages of NSTG protocols) into a highly optimized SQLite database under **350KB** (well below the 25MB design ceiling).
4. **Zero Alert Fatigue Triage:** Utilizes a deterministic visual triage system that only interrupts clinicians when high-risk contraindications or severe drug-drug interactions are found:
   - **Tier 1 (Instant Pass - Green):** Dosage matches guidelines; no interactions.
   - **Tier 2 (Conditional Checklist - Amber):** Prompts the clinician with a target demographic checklist (e.g., pregnancy or renal status) for specific high-risk drugs.
   - **Tier 3 (Hard Block - Crimson):** Severe dosage or drug-drug interaction detected, displaying an explicit clinical alert with the exact NSTG page/chapter citation.
5. **Hardware-Friendly Static Shutter:** Eliminates continuous video stream parsing to prevent thermal throttling and battery drain on low-end tablets.

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
│   ├── public/                 # Static static resources
│   │   ├── database/           # SQLite database asset (rxshield_core.db)
│   │   ├── models/             # Quantized ONNX character model (crnn_int8.onnx)
│   │   └── wasm/               # WebAssembly binaries for database & model execution
│   ├── src/
│   │   ├── components/         # Presentation Layer (Camera view, Dashboard, Alerts)
│   │   ├── services/           # Data & Computational Core Interfaces (dbService, ocrService)
│   │   ├── workers/            # Multi-Threaded Execution Layer (inference.worker.js)
│   │   └── utils/              # Pure computational utilities (symspell normalizer)
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
   Ensure your raw source datasets are available under `data/raw/` (e.g., `eml_export.xlsx` and `NSTG 2022 PDF`).

### Sequential Execution Steps

Run the pipeline scripts in exact numerical order to clean files, extract protocols, compile the database, and quantize the model:

```bash
# 1. Ingest and normalize EML directory
python scripts/01_ingest_eml_directory.py

# 2. Fetch and aggregate openFDA adverse drug-drug interactions
python scripts/02_fetch_adverse_events.py

# 3. Rasterize and OCR NSTG PDF chapters
python scripts/03_extract_nstg_protocols.py

# 4. Parse, normalize, and regularize raw text using EML cross-referencing
python scripts/04_clean_and_validate_protocols.py

# 5. Compile processed CSV files into SQLite database
python scripts/05_compile_sqlite.py

# 6. Quantize PyTorch model weights to INT8 and compile ONNX binary
python scripts/06_export_edge_vision_model.py
```

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
2. The buffer is shipped across a thread boundary to `inference.worker.js` (Web Worker) managed via **Comlink**.
3. The Web Worker executes the **INT8 ONNX model** via `@onnxruntime/web` using WebAssembly.
4. Extracted OCR strings are passed to the **SymSpell Normalizer** (in-memory Levenshtein distance) to correct spelling and resolve typos to EML generic IDs.
5. The normalized EML ID is queried against the local **SQLite WASM Database** (`wa-sqlite`) to check NSTG safety boundaries and drug-drug interactions.
6. The worker returns a UI-safe state payload, triggering the React UI to transition color states.

---

## 6. Local Relational SQLite Schema

The local relational schema is structured as follows:

### `drugs`
Maps local brand nomenclature to generic identifiers.
- `id` (INTEGER, PRIMARY KEY)
- `brand_name` (TEXT)
- `generic_name` (TEXT, Indexed)
- `atc_code` (TEXT)

### `nstg_protocols`
Dosage thresholds, treatment duration, and demographic checking rules translated from Nigeria Standard Treatment Guidelines.
- `id` (INTEGER, PRIMARY KEY)
- `generic_name` (TEXT)
- `max_single_dose_mg` (REAL)
- `max_daily_dose_mg` (REAL)
- `max_duration_days` (INTEGER)
- `requires_pregnancy_check` (INTEGER)
- `requires_renal_check` (INTEGER)
- `citation_reference` (TEXT)

### `drug_interactions`
The adverse interaction combinations matrix compiled from openFDA logs.
- `id` (INTEGER, PRIMARY KEY)
- `atc_code_a` (TEXT)
- `atc_code_b` (TEXT)
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
This exports the static files into `rxshield-web/out/`.

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
