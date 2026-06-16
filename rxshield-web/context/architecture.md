# Architectural Specification: RxShield

This document defines the technical architecture, system boundaries, storage layout, and operational invariants for RxShield. Every code modification executed by the AI agent must strictly conform to this specification.

---

## 1. Technology Stack

RxShield is architected as a local-first, zero-network, client-driven edge application deployed as a Progressive Web App (PWA).

| Layer | Technology | Component/Library | Architectural Role |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React / Next.js (Static Export) | `next export` / Vanilla React Components | Handles reactive UI rendering, local application state, and asset bundling. |
| **Edge Vision Engine** | ONNX Runtime Web (WASM) | `@onnxruntime/web` | Executes the INT8-quantized CRNN text-extraction model inside a browser Web Worker thread. |
| **Embedded Database** | SQLite via WebAssembly | `wa-sqlite` or `sql.js` | Holds compiled, indexed relational tables for clinical cross-referencing entirely in browser RAM. |
| **Spelling Normalization** | Levenshtein / SymSpell Wrapper | Custom Client-Side JS Utility | Maps flawed OCR text strings directly to clean, standardized generic IDs against the local database. |
| **Hosting & Deployment** | Static CDN | Vercel / Netlify / GitHub Pages | Serves the initial static file bundle (HTML, JS, WASM binaries, model weights, and SQLite DB blob). |

---

## 2. System Boundaries & File Structure

The codebase isolates components into distinct layers to enforce structural boundaries. No UI component may directly execute SQL or manipulate model tensors; all interactions must transition across structured interfaces.

``` md
src/
├── public/                 # Static compiled assets downloaded once by browser
│   ├── models/             # Quantized CRNN handwriting model (crnn_int8.onnx)
│   └── database/           # Compiled 25MB clinical relational engine (rxshield_core.db)
├── src/
│   ├── components/         # Pure UI / Presentation Layer
│   │   ├── Camera/         # Static Shutter Viewfinder, crop bounds, binarization canvas
│   │   ├── Dashboard/      # Main layout, progressive badge rendering
│   │   └── Alerts/         # Crimson blocks, conditional verification checklists
│   ├── workers/            # Multi-Threaded Execution Layer
│   │   └── inference.worker.js # Dedicates a Web Worker to manage ONNX + SQLite loops
│   ├── services/           # Data & Computational Core Interfaces
│   │   ├── ocrService.ts   # Image buffer optimization and tensor formatting
│   │   └── dbService.ts    # Instantiates WASM SQLite connection and executes local joins
│   └── utils/              # Pure mathematical operations
│       └── symspell.ts     # In-memory string distance lookup for drug names
```

---

## 3. Storage Model

To maintain a zero-network runtime, the application treats data tiers as read-only local structures loaded directly into client-side execution boundaries.

| Storage Type | Target Data Assets |
| :--- | :--- |
| **File Storage (Public Asset)** | • crnn_int8.onnx (15MB quantized model) • rxshield_core.db (25MB SQLite binary) |
| **In-Memory RAM (WASM Engine)** | • Instantiated SQLite Relational Tables • SymSpell Dictionary Array Strings |
| **Service Worker Cache (PWA)** | • Core UI Bundles (HTML, JS, CSS) • Cached Model Weights & Database Blob |

### Relational Database Schema Contracts (SQLite)

The application expects the local `rxshield_core.db` file to adhere strictly to the following relational schemas:

* **`drugs`**: Maps local brand nomenclature to generic identifiers.
  * `id` (INTEGER, PK), `brand_name` (TEXT), `generic_name` (TEXT, Indexed), `atc_code` (TEXT)
* **`nstg_protocols`**: Contains decision boundaries translated directly from the Nigeria Standard Treatment Guidelines.
  * `id` (INTEGER, PK), `generic_name` (TEXT), `max_single_dose_mg` (REAL), `max_daily_dose_mg` (REAL), `max_duration_days` (INTEGER), `requires_pregnancy_check` (INTEGER), `requires_renal_check` (INTEGER), `citation_reference` (TEXT)
* **`drug_interactions`**: Compact interaction matrix pre-processed from aggregated OpenFDA logs.
  * `id` (INTEGER, PK), `atc_code_a` (TEXT), `atc_code_b` (TEXT), `severity` (TEXT), `risk_description` (TEXT)

---

## 4. Background Execution & Edge Inference Pipeline

To preserve 60FPS UI performance and eliminate application crashes under memory pressure, all computer vision tasks and data evaluations run inside a secondary browser thread.

* **[UI Thread: Camera Component]**
  * *Payload:* Passes raw `ImageData` via transferable object buffer.
  * ▼
* **[Web Worker Thread: `inference.worker.js`]**
  * **1. Run INT8 ONNX Engine** → Outputs character matrix
  * **2. Run SymSpell Utility** → Matches character string to Drug Generic ID
  * **3. Execute SQLite Queries** → Checks dosage boundaries & interaction rows
  * ▼
* **[UI Thread: Reactive Re-render]**
  * *Payload:* Returns lightweight UI state JSON.
  * *Action:* Transitions layout color state (Green / Yellow / Crimson).

---

## 5. Architectural Invariants (Unviolable Codebase Rules)

The AI coding agent must reject any instruction or modification that violates these five rules:

1. **The Zero-Network Invariant:** The codebase must never instantiate `fetch`, `axios`, `XMLHttpRequest`, or any WebSocket connection within the core prediction, extraction, or validation loops. Every single computational step must execute entirely offline on local resources.
2. **The Main-Thread Isolation Invariant:** The UI main thread must never execute tensor manipulation, ONNX model evaluations, or SQLite query statements directly. All mathematical and data evaluation logic must remain fully contained inside the Web Worker wrapper.
3. **The Relational Integrity Invariant:** The application must never use Generative AI, Large Language Models (LLMs), or probability-based models to formulate clinical advice, list contraindications, or invent side effects on the fly. The AI's role terminates at text extraction. Every medical evaluation step must remain 100% deterministic, matching the extracted generic ID to the exact columns in the hardcoded SQLite database.
4. **The Memory Footprint Hard Cap:** The combined build size of the compiled production application bundle, including the `.onnx` weight file and the `.db` storage file, must not exceed **45MB**. Any dependency introduction that balloons the distribution payload will be rolled back.
5. **The Structural Flow Separation Invariant:** The database operations layer must never consume un-normalized text strings straight from the vision layer. All raw text strings extracted by the ONNX vision engine *must* transition through the string distance normalizer utility (SymSpell/Levenshtein) before hitting SQL query arguments to eliminate data mismatches due to minor spelling anomalies.
