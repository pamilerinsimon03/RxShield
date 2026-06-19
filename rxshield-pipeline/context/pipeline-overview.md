# Data Pipeline Inventory & Asset Tracking Overview

This document tracks the macro-level sourcing targets, input files, and processing statuses of all datasets required to compile the RxShield offline relational database.

---

## 1. High-Level Pipeline Objective

The core data goal is to take multiple distinct, raw data feeds (unstructured PDFs, massive open-source incident logs, and seed matrices) and unify them into a single, highly relational SQLite file. This file must map faulty handwritten strings to clean generic entities, audit them against national protocols, and check for severe drug-drug interactions.

---

## 2. Dataset Sourcing Registry & Status Board

| Dataset Identifier | Target Core Function | Source Origin | Expected Input Format | Integration Status |
| :--- | :--- | :--- | :--- | :--- |
| **NSTG Protocol Book** | Sets the maximum safe dosages, treatment durations, and demographic risk flags. | Nigeria Standard Treatment Guidelines | Raw Text / Document PDF | ⏳ Awaiting Delivery |
| **OpenFDA Interactions** | Provides high-severity adverse cross-interaction pairs. | US Food & Drug Administration | Multi-GB JSON Dumps / Zipped Logs | ✅ Received |
| **Local Drug Directory** | Maps specific Nigerian local brand names to international generic chemical listings. | Local Pharmaceutical Indices | Raw Excel / CSV Matrix | ⏳ Awaiting Delivery |
| **Synthetic Handwriting Seed** | Used to procedurally generate the 50,000 image training labels for edge vision. | Open Source Stroke Fonts & Medical Sig Tables | Font Files / Plain Text | 🔄 In-Progress |

---

## 3. Input-to-Output Flow Mapping

The pipeline scripts process raw inputs through a progressive assembly line:

1. **`data/raw/` (Ingestion Boundary):** Where raw source files are placed as soon as they are gathered by the team.
2. **`data/processed/` (Transformation Boundary):** Python cleaning scripts parse, filter, and normalize the raw inputs into uniform, case-sanitized intermediate CSVs.
3. **`data/output/` (Compilation Boundary):** The final script reads the processed CSVs, initializes database tables, builds performance indexes, compresses the data structure, and exports the clean `rxshield_core.db` file.

---

## 4. Active Blockers & Coordination Notes

* **Blocker 1:** Scripting for the NSTG Protocol engine cannot begin until the raw document text is dropped into `data/raw/`.
* **Blocker 2:** Processing of the OpenFDA dump requires immediate chunked streaming filters to prune non-essential columns before saving, to prevent developer machines from running out of disk space during execution.
