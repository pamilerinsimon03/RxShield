# Build Plan: RxShield Incremental Execution Strategy

This document establishes the chronological build order for RxShield. Every engineering task must be executed strictly sequence-by-sequence. Dependencies are imported just-in-time, system boundaries are tightly preserved, and the execution thread moves systematically from local-first backend workers to presentation layers.

---

## The Build Order Matrix

### Unit 1: Base Project Scaffolding & Edge Configuration

* **What it builds:** Initial React/Next.js workspace structure, customized strict TypeScript rules configuration (`tsconfig.json`), and the Progressive Web App static export manifest rules.
* **Files created/modified:** `package.json`, `tsconfig.json`, `next.config.js`, `public/manifest.json`.
* **Just-in-Time Package Installations:** `typescript`, `next`, `react`, `react-dom`, `tailwindcss`.
* **Dependencies required:** None.

### Unit 2: Core Web Worker & System Message Bus Scaffolding

* **What it builds:** The isolated thread message bus architecture. Instantiates the client background Web Worker wrapper that intercepts computational loads, setting up the empty Request/Response serialization listeners.
* **Files created/modified:** `src/workers/inference.worker.js`, `src/services/workerInterface.ts`.
* **Just-in-Time Package Installations:** None.
* **Dependencies required:** Unit 1 baseline directories.

### Unit 3: Local SQLite Engine & Data Pipeline Scaffolding

* **What it builds:** WebAssembly SQLite runtime implementation inside the background worker thread. Mounts the mock-seeded 25MB clinical relational file asset structure (`rxshield_core.db`) containing the relational table architectures for the WHO EML, NSTG rules, and OpenFDA logs.
* **Files created/modified:** `src/workers/inference.worker.js` (updated), `src/services/dbService.ts`, `public/database/rxshield_core.db` (mock baseline).
* **Just-in-Time Package Installations:** `wa-sqlite` (or `sql.js`).
* **Dependencies required:** Unit 2 message bus framework.

### Unit 4: Spelling Distance Normalization & Database Join Pipeline

* **What it builds:** The in-memory Levenshtein / SymSpell text matching layer inside the background worker. This unit maps faulty typo-prone text strings straight to clean database generic IDs and queries the deterministic NSTG decision metrics.
* **Files created/modified:** `src/utils/symspell.ts`, `src/workers/inference.worker.js` (updated logic engine).
* **Just-in-Time Package Installations:** None.
* **Dependencies required:** Unit 3 SQLite relational layout.

### Unit 5: On-Device Vision Execution Layer (ONNX Web WASM)

* **What it builds:** Integrates ONNX Runtime Web inside the background Web Worker thread. Loads the static 15MB INT8-quantized CRNN character recognition model graph and pipes a mock image byte buffer array through it to verify local OCR extraction output.
* **Files created/modified:** `src/workers/inference.worker.js` (vision loop injection), `src/services/ocrService.ts`, `public/models/crnn_int8.onnx` (model placeholder bundle).
* **Just-in-Time Package Installations:** `@onnxruntime/web`.
* **Dependencies required:** Unit 4 string normalization loops.

### Unit 6: Central Core Layout & State Management Frame

* **What it builds:** The core shell presentation environment container. Implements the root layout layout, global reactive context boundaries to trace progressive pipeline tracking (`idle` ➔ `extraction` ➔ `validation` ➔ `complete`), and a secure hardcoded fallback PIN access mechanism.
* **Files created/modified:** `src/components/Dashboard/MainLayout.tsx`, `src/context/WorkflowStateContext.tsx`.
* **Just-in-Time Package Installations:** `lucide-react` (for icons).
* **Dependencies required:** Unit 1 and Unit 2 interfaces.

### Unit 7: Static Camera Shutter Viewfinder & Binarization Module

* **What it builds:** The local media camera capturing system block. Deploys the static SVG box framing overlay guides, binds local hardware camera device media feeds, and constructs the pure HTML5 canvas binarization optimizer tool to clean single captured frame pixels.
* **Files created/modified:** `src/components/Camera/CameraViewfinder.tsx`, `src/components/Camera/CameraOverlay.tsx`, `src/components/Camera/cameraUtils.ts`, `src/components/Camera/useCameraHardware.ts`.
* **Just-in-Time Package Installations:** None.
* **Dependencies required:** Unit 6 Layout shells.

### Unit 8: Progressive Validation Badge Box & Hackathon Simulation Panel

* **What it builds:** The step-by-step extraction card display. Renders raw text tokens instantly as they bridge from the background worker thread. Includes a secondary judge panel selector containing pre-loaded image files from the Synthetic dataset to run full mock extractions live on stage.
* **Files created/modified:** `src/components/Dashboard/ExtractionBadges.tsx`, `src/components/Dashboard/JudgeSimulationPanel.tsx`.
* **Just-in-Time Package Installations:** None.
* **Dependencies required:** Unit 5 Vision execution framework and Unit 7 capture outputs.

### Unit 9: Conditional Triage Alert Layout & Safety Checklist Overlay

* **What it builds:** The definitive safety output component engine. Renders full color-coded diagnostic result sheets based on worker verdicts: Green Pass panels for clean codes, Yellow overlay modules for target demographic checklists (pregnancy/renal overrides), and Crimson hard block warning cards complete with specific NSTG chapter citations.
* **Files created/modified:** `src/components/Alerts/TriageAlertCard.tsx`, `src/components/Alerts/DemographicChecklist.tsx`.
* **Just-in-Time Package Installations:** None.
* **Dependencies required:** Unit 4 Database rules pipeline and Unit 8 display badges.

### Unit 10: Full Offline-PWA Validation Testing & Bundle Compression Review

* **What it builds:** Compiles the entire static production distribution bundle via Next.js exports. Configures full offline caching rules within the Service Worker registration to verify zero-network app survival. Measures final bundle metrics to ensure compilation assets remain securely under the 45MB limit constraint.
* **Files created/modified:** `public/sw.js`, `src/index.tsx` (Service Worker binding block).
* **Just-in-Time Package Installations:** None.
* **Dependencies required:** All previous units (Units 1 through 9 structural codebases).
