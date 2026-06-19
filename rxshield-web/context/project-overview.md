# Project Overview: RxShield

RxShield is an offline-first, local-edge, mobile-optimized Progressive Web App (PWA) designed to intercept medication prescription errors at the point of dispensing in understaffed, power-unstable Nigerian clinical settings. By combining an on-device WebAssembly (WASM) computer vision pipeline with a highly compressed, localized SQLite clinical rule engine, the application allows frontline pharmacists and nurses to capture an image of a handwritten prescription script, instantly extract drug names and dosages, and evaluate them against the official Nigeria Standard Treatment Guidelines (NSTG) and drug-drug interaction logs—completely without internet access or cloud server dependencies.

---

## 1. Project Goals

1. **Zero-Connectivity Clinical Safety:** Deliver automated prescription error detection that functions 100% locally in low-resource environments with unstable grids and no cellular data connectivity.
2. **Sub-Second Execution Matrix:** Achieve an end-to-end processing latency of under 1,000 milliseconds from the moment a static prescription image is submitted to the final clinical alert rendering.
3. **Radical Data Compression:** Condense massive global clinical datasets (10M+ OpenFDA entries) and localized medical texts (500+ pages of NSTG protocols) into a lightweight relational SQLite database under 25MB.
4. **Zero Alert Fatigue:** Build an algorithmic triage interface that only interrupts the clinician with an active verification gate when a high-risk demographic contraindication or severe drug-drug interaction is deterministically discovered.
5. **Universal Edge Compatibility:** Ensure the entire application stack runs smoothly inside standard web browsers on low-end hardware (cheap Android tablets, old laptops, or a local Raspberry Pi server) without thermal throttling or memory exhaustion.

---

## 2. Step-by-Step Core User Flow

1. **Initiation:** The pharmacist or nurse opens the RxShield PWA on a tablet or laptop. The interface instantly exposes a static camera viewfinder overlay taking up the upper half of the viewport, with a white, empty results card docked below.
2. **Image Capture:** The pharmacist aligns the handwritten paper prescription within the static visual guide boundaries and clicks a manual physical shutter button to capture a single static frame (eliminating the thermal and processing overhead of a continuous live camera stream).
3. **Progressive Rendering (Stage 1 - Extraction):** Within 400ms of capture, the on-device Computer Vision pipeline binarizes the frame, processes it through an INT8-quantized CRNN model via ONNX Runtime Web, and spits out the raw text. The lower UI card instantly updates to display the recognized text badges (e.g., `[Augmentin 625mg]`, `[BD (Twice Daily)]`).
4. **Algorithmic Evaluation (Stage 2 - Validation):** The background thread instantly routes these raw strings through a localized SymSpell/Levenshtein string-distance utility to snap typos to a standardized WHO Essential Medicines generic ID. The system then queries the local SQLite file to evaluate dosage parameters and cross-reference multiple drugs on the same sheet.
5. **Deterministic Triage Display (Stage 3 - Verdict):** By the 800ms mark, the UI updates to its final deterministic safety state:
    * **Tier 1 (Instant Pass):** If the prescription contains standard, routine dosages with no interactions, the card flashes solid green: *“Dosage Matches NSTG Guidelines. No Known Interactions.”* The user dispenses immediately.
    * **Tier 2 (Conditional Checklist):** If the drug possesses extreme demographic risks (e.g., pediatric or pregnancy contraindications), the UI shifts colors and presents a 2-second target checklist (e.g., `[ ] Is the patient pregnant?`). Checking "Yes" triggers a hard crimson warning; checking "No" triggers a green pass.
    * **Tier 3 (Hard Interaction/Dosage Error):** If a toxic dosage or a severe drug-drug interaction from the aggregated OpenFDA table is found, the screen flashes flashing crimson, locking the view with an explicit medical alert citing the exact NSTG chapter and page number to enforce clinical correction.

---

## 3. Features by Category

### Computer Vision & Parsing

* **Static Shutter Engine:** Camera module optimized to capture and isolate a single static image array, preventing hardware overheating.
* **INT8 CRNN Model Runtime:** Client-side character recognition engine executing a quantized Convolutional Recurrent Neural Network via WebAssembly.
* **SymSpell Lexicon Normalization:** Internal spelling-distance database wrapper that maps flawed handwritten text strings instantly to exact generic medical drug names.

### Data & Rule Engine

* **Embedded Relational Reference Backend:** A compiled, local-first SQLite file containing structured relational tables of the WHO Essential Medicines List and local brand variants.
* **Deterministic NSTG Decision Tree:** A compiled decision table containing exact dosage boundaries and line-of-treatment parameters derived directly from the Nigeria Standard Treatment Guidelines.
* **Aggregated Interaction Matrix:** A compact, indexed table mapping critical drug-drug interaction combinations extracted and synthesized from OpenFDA logs.

### User Interface & Triage

* **Multi-Stage Progressive UI:** A user interface that updates dynamically as components finish computing, dropping perceived app latency.
* **Conditional Safety Modals:** Contextual checklist overlays that render dynamically *only* when a specific generic drug requires demographic verification.
* **Hard Block Medical Alert Screen:** High-visibility, crimson alert cards displaying clear error classifications and precise guideline references.

---

## 4. Scope Boundaries

### In-Scope (What We Are Building for the Hackathon)

* A deployable, client-side Progressive Web App (PWA) accessible via a static hosting URL (Vercel/Netlify/GitHub Pages).
* A fully client-side inference pipeline that executes handwriting extraction using an INT8-quantized ONNX model running inside browser WebAssembly memory.
* An offline SQLite database (SQL.js / WaSqlite) under 25MB compiled directly into the application build, containing structured representations of the WHO Essential Medicines List, the Nigeria Standard Treatment Guidelines (NSTG), and aggregated OpenFDA interaction risks.
* A progressive 3-stage UI showing raw extraction, database lookup confirmation, and a final triaged safety color state (Green Pass, Conditional Yellow Checklist, Crimson Hard Block Alert).
* A "Simulate Scan" feature in the UI allowing judges to pick from pre-loaded prescription images (generated via the Synthetic dataset) to bypass stage lighting constraints during the live pitch.

### Out-of-Scope (Explicitly Deferred to Phase 2)

* **Cloud Infrastructure & Syncing:** No remote servers, external APIs, cloud databases, or data synchronization features.
* **Dynamic Patient History Document Scanning:** No optical scanning or parsing of multi-page paper patient folders or chaotic external clinical cards.
* **Authentication and Access Controls:** No complex multi-user role management, biometric security, or credential recovery microservices (restricted to a single hardcoded local PIN entry for login simulation).
* **Electronic Medical Record (EMR) Integration:** No active FHIR, HL7, or local database piping into existing hospital information systems.

---

## 5. Success Criteria ("Definition of Done")

* **100% Offline Autonomy:** The hosted web link can be loaded, the device's internet can be completely turned off (Airplane Mode), and a prescription image can be successfully read and validated against the guidelines without throwing network errors.
* **Total Resource Envelope Limit:** The bundled `.onnx` vision model file and the compiled `.db` SQLite database file do not exceed a combined package size of **45MB** in browser storage cache.
* **Latency Cap Compliance:** The end-to-end execution path—from the moment the user confirms an image capture to the final UI color render state—consistently scores under **1,000 milliseconds** on mid-to-low tier client hardware.
* **Deterministic Precision:** Given a simulated prescription image containing a known lethal dosage or conflicting drug combination, the system accurately blocks the workflow and surfaces the correct, corresponding chapter and page citation from the NSTG 100% of the time, without exception or hallucination.
