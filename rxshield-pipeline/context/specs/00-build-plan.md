# RxShield Core Data Pipeline Build Plan

This document establishes the chronological implementation order, system boundaries, and just-in-time package installations for the data compilation and machine learning pipeline modules.

---

## Unit 11: Ingestion Scaffolding & EML Directory Ingestion

* **What it builds:** The internal data folder architecture and the master drug database parser script (`scripts/01_ingest_eml_directory.py`). This script processes the clean baseline CSV file (`eml_export.xlsx - Worksheet.csv`) into a standardized, case-sanitized intermediate dataframe layout tracking active chemical names and ATC classification mappings.
* **Dependencies:** Clean EML CSV present within the `data/raw/` path.
* **Packages installed:** `pandas` (for lightweight dataframe filtering and structured matrix tabular processing).

---

## Unit 12: Automated openFDA Adverse Events Extraction Engine

* **What it builds:** The automated programmatic downloader script (`scripts/02_fetch_adverse_events.py`). The module downloads openFDA's master online `download.json` manifest metadata, isolates the most recent data block partitions (2024/2025/2026), downloads those specific compressed JSON zip chunks, and aggregates severe drug-drug cross-interaction pairs while stripping out low-count background statistical anomalies.
* **Dependencies:** Successful data folder architecture initialized in Unit 11.
* **Packages installed:** `requests` (for programmatic JSON manifest lookups and file binary streaming transactions).

---

## Unit 13: Local High-Resolution NSTG Protocol OCR Pipeline

* **What it builds:** The core guideline conversion script (`scripts/03_extract_nstg_protocols.py`). This script opens the high-resolution vector PDF scan page by page, rasterizes target clinical protocol blocks at 300 DPI, and triggers a sharp localized OCR compilation pass via Tesseract to pull raw layout blocks.
* **Dependencies:** Clear, high-contrast `Nigeria%20Standard%20Treatment%20Guidelines%202022.pdf` placed safely within the `data/raw/` ingestion bucket.
* **Packages installed:** `pymupdf` (for rapid PDF page rasterization and built-in Tesseract OCR sub-routines).

---

## Unit 14: Data Cleaning, Token Regularization & Validation Mapping

* **What it builds:** The crucial validation engine (`scripts/04_clean_and_validate_protocols.py`). Because the NSTG source is an un-selectable image scan, this script applies regular expression string normalization checks across the raw OCR text output. It trims structural formatting anomalies, forces uppercase uniformity, maps messy titles to clear generic classifications, and filters out parsing artifacts to ensure exact columns like safe maximum dosages and demographic flags align with the relational schema.
* **Dependencies:** Raw text extractions from Unit 13.
* **Packages installed:** None. (Leverages standard library `re` and existing `pandas`).

---

## Unit 15: Relational Database Assembly & Vacuum Compilation

* **What it builds:** The final database compilation script (`scripts/05_compile_sqlite.py`). This engine initializes a clean SQLite workspace, instantiates target schemas (`drugs`, `nstg_protocols`, `drug_interactions`), performs rapid batch row inserts from processed intermediate files, builds unique composite indexes to drive real-time edge searches, and issues strict execution optimization commands like `ANALYZE; VACUUM;`.
* **Dependencies:** Clean, parsed data files generated dynamically by Units 11, 12, and 14 inside `data/processed/`.
* **Packages installed:** None. Uses the native Python standard library `sqlite3` driver.

---

## Unit 16: Edge Vision Dataset Streaming & ONNX Model Optimization

* **What it builds:** The automated computer vision utility script (`scripts/06_export_edge_vision_model.py`). This program pulls down the `Teklia/IAM-line` dataset directly via the Hugging Face hub, downloads the pre-trained weights file slice (`best_model.pth`), serializes the PyTorch sequence architecture into a flat ONNX file array, and runs an INT8 quantization pass to compress the target footprint to fit within mobile constraints.
* **Dependencies:** Unified relational compilation output passing checks in Unit 15.
* **Packages installed:** `datasets` (for Hugging Face streaming compatibility), `torch` (for network evaluation architecture handling), and `onnxruntime` (for running local quantization optimization passes).
