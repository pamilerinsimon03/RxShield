import os
import csv
import sqlite3
import shutil

def levenshtein_distance(s1, s2):
    """
    Computes the Levenshtein distance between s1 and s2.
    """
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
        
    return previous_row[-1]

def build_eml_atc_map(eml_path):
    """
    Builds a map from EML Medicine name to ATC code.
    If a drug has comma-separated ATC codes, we map it to the first code.
    """
    eml_to_atc = {}
    if not os.path.exists(eml_path):
        print(f"Warning: EML reference file not found at {eml_path}")
        return eml_to_atc

    with open(eml_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            medicine = row.get('Medicine', '').strip().upper()
            atc_code = row.get('ATC Code', '').strip().upper()
            if medicine and atc_code:
                # Take the first ATC code if comma-separated
                first_atc = atc_code.split(',')[0].strip()
                if first_atc:
                    eml_to_atc[medicine] = first_atc
    return eml_to_atc

# Caching for fuzzy matches to prevent redundant expensive computations
fuzzy_cache = {}

def get_atc_code(drug_name, eml_to_atc):
    """
    Resolves a drug name to its ATC code from EML.
    Uses exact lookup, followed by fuzzy Levenshtein repair (dist <= 2, conf > 90% or dist == 1).
    """
    if not drug_name:
        return None
        
    drug_name = drug_name.strip().upper()
    if drug_name in eml_to_atc:
        return eml_to_atc[drug_name]
        
    if drug_name in fuzzy_cache:
        return fuzzy_cache[drug_name]

    best_match = None
    min_dist = 999
    
    for eml_name in eml_to_atc:
        dist = levenshtein_distance(drug_name, eml_name)
        if dist <= 2:
            max_len = max(len(drug_name), len(eml_name))
            confidence = 1.0 - (dist / max_len)
            if dist == 1 or confidence > 0.90:
                if dist < min_dist:
                    min_dist = dist
                    best_match = eml_name
                    
    resolved_atc = eml_to_atc[best_match] if best_match else None
    fuzzy_cache[drug_name] = resolved_atc
    return resolved_atc

def compile_database():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    processed_dir = os.path.join(base_dir, 'data', 'processed')
    output_dir = os.path.join(base_dir, 'data', 'output')
    
    db_path = os.path.join(output_dir, 'rxshield_core.db')
    eml_csv_path = os.path.join(processed_dir, 'eml_normalized.csv')
    protocols_csv_path = os.path.join(processed_dir, 'nstg_protocols_clean.csv')
    interactions_csv_path = os.path.join(processed_dir, 'openfda_interactions.csv')

    print("Step 1: Ingesting reference datasets...")
    eml_to_atc = build_eml_atc_map(eml_csv_path)
    print(f"Mapped {len(eml_to_atc)} generic medication names to ATC codes from EML.")

    # Remove existing database file if it exists to start fresh
    if os.path.exists(db_path):
        print(f"Removing existing database file: {db_path}")
        os.remove(db_path)

    print(f"\nStep 2: Connecting to SQLite database at: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Enable foreign keys check
    cursor.execute("PRAGMA foreign_keys = ON;")

    print("Step 3: Deploying schema tables...")
    cursor.execute("""
    CREATE TABLE drugs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_name TEXT NOT NULL COLLATE NOCASE,
        generic_name TEXT NOT NULL COLLATE NOCASE,
        atc_code TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE nstg_protocols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generic_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        max_single_dose_mg REAL,
        max_daily_dose_mg REAL,
        max_duration_days INTEGER,
        requires_pregnancy_check INTEGER NOT NULL CHECK (requires_pregnancy_check IN (0, 1)),
        requires_renal_check INTEGER NOT NULL CHECK (requires_renal_check IN (0, 1)),
        guideline_citation TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE drug_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        atc_code_a TEXT NOT NULL,
        atc_code_b TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('DANGER', 'WARNING')),
        risk_description TEXT NOT NULL
    );
    """)

    print("Step 4: Setting up composite indices...")
    cursor.execute("CREATE UNIQUE INDEX idx_drugs_lookup ON drugs (brand_name, generic_name);")
    cursor.execute("CREATE INDEX idx_interactions_lookup ON drug_interactions (atc_code_a, atc_code_b);")

    print("\nStep 5: Populating 'drugs' table...")
    drugs_records = []
    
    # Track unique brand+generic composite pairs to prevent unique constraint failures
    unique_drugs = set()

    # Popular Brand-to-Generic Mappings
    BRAND_MAPPINGS = [
        ("AUGMENTIN", "AMOXICILLIN + CLAVULANIC ACID", "J01CR02"),
        ("PANADOL", "PARACETAMOL", "N02BE01"),
        ("TYLENOL", "PARACETAMOL", "N02BE01"),
        ("GLUCOPHAGE", "METFORMIN", "A10BA02"),
        ("LIPITOR", "ATORVASTATIN", "C10AA05"),
        ("ZOCOR", "SIMVASTATIN", "C10AA01"),
        ("PLAVIX", "CLOPIDOGREL", "B01AC04"),
        ("VENTOLIN", "SALBUTAMOL", "R03AC02"),
        ("ASPIRIN", "ACETYLSALICYLIC ACID", "B01AC06"),
        ("VOLTAREN", "DICLOFENAC", "M01AB05"),
        ("LASIX", "FUROSEMIDE", "C03CA01"),
        ("NORVASC", "AMLODIPINE", "C08CA01"),
        ("ZESTRIL", "LISINOPRIL", "C09AA03"),
    ]

    for brand, generic, atc in BRAND_MAPPINGS:
        brand = brand.strip().upper()
        generic = generic.strip().upper()
        atc = atc.strip().upper()
        pair = (brand, generic)
        if pair not in unique_drugs:
            unique_drugs.add(pair)
            drugs_records.append((brand, generic, atc))

    # Read EML normalized file
    with open(eml_csv_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            medicine = row.get('Medicine', '').strip().upper()
            atc_code = row.get('ATC Code', '').strip().upper()
            if medicine:
                # EML Medicine acts as both brand_name and generic_name
                pair = (medicine, medicine)
                if pair not in unique_drugs:
                    unique_drugs.add(pair)
                    drugs_records.append((medicine, medicine, atc_code))

    cursor.executemany(
        "INSERT OR IGNORE INTO drugs (brand_name, generic_name, atc_code) VALUES (?, ?, ?);",
        drugs_records
    )
    print(f"Populated drugs table with {len(drugs_records)} unique records.")

    print("\nStep 6: Populating 'nstg_protocols' table...")
    protocols_records = []
    with open(protocols_csv_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            generic_name = row.get('generic_name', '').strip().upper()
            
            # Numeric columns
            single_dose = row.get('max_single_dose_mg')
            single_dose = float(single_dose) if single_dose else None
            
            daily_dose = row.get('max_daily_dose_mg')
            daily_dose = float(daily_dose) if daily_dose else None
            
            duration = row.get('max_duration_days')
            duration = int(duration) if duration else None
            
            preg_check = int(row.get('requires_pregnancy_check', 0))
            renal_check = int(row.get('requires_renal_check', 0))
            
            citation = row.get('guideline_citation')
            citation = citation.strip() if citation else None

            if generic_name:
                protocols_records.append((
                    generic_name, single_dose, daily_dose, duration,
                    preg_check, renal_check, citation
                ))

    cursor.executemany(
        """
        INSERT INTO nstg_protocols (
            generic_name, max_single_dose_mg, max_daily_dose_mg, max_duration_days,
            requires_pregnancy_check, requires_renal_check, guideline_citation
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
        """,
        protocols_records
    )
    print(f"Populated nstg_protocols table with {len(protocols_records)} records.")

    print("\nStep 7: Populating 'drug_interactions' table...")
    interactions_records = []
    skipped_count = 0
    unique_interactions = set()

    with open(interactions_csv_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            drug_a = row.get('generic_name_a', '').strip().upper()
            drug_b = row.get('generic_name_b', '').strip().upper()
            severity = row.get('severity', '').strip().upper()

            # Resolve to ATC codes using map
            atc_a = get_atc_code(drug_a, eml_to_atc)
            atc_b = get_atc_code(drug_b, eml_to_atc)

            if atc_a and atc_b:
                if atc_a == atc_b:
                    skipped_count += 1
                    continue
                # Order ATC codes alphabetically to ensure uniqueness in composite queries
                atc_first = min(atc_a, atc_b)
                atc_second = max(atc_a, atc_b)
                
                interaction_key = (atc_first, atc_second)
                
                if interaction_key not in unique_interactions:
                    unique_interactions.add(interaction_key)
                    # Construct description
                    desc = f"Concurrent use of {drug_a} and {drug_b} is associated with a high frequency of adverse events (severity: {severity})."
                    interactions_records.append((atc_first, atc_second, severity, desc))
            else:
                skipped_count += 1

    cursor.executemany(
        """
        INSERT INTO drug_interactions (
            atc_code_a, atc_code_b, severity, risk_description
        ) VALUES (?, ?, ?, ?);
        """,
        interactions_records
    )
    print(f"Populated drug_interactions table with {len(interactions_records)} unique records.")
    print(f"Skipped {skipped_count} interaction rows due to unmapped ATC codes or self-interactions.")

    # Commit all transactions before optimization
    conn.commit()

    print("\nStep 8: Finalizing compilation with vacuum and indexing analysis...")
    cursor.execute("PRAGMA optimize;")
    cursor.execute("ANALYZE;")
    cursor.execute("VACUUM;")
    conn.commit()
    conn.close()

    db_size = os.path.getsize(db_path)
    print(f"Successfully generated database binary asset at: {db_path}")
    print(f"Database file size: {db_size / 1024.0 / 1024.0:.3f} MB ({db_size} bytes)")

    # Step 9: Cross-Boundary Asset Mapping

    # Web copies (assets and database directories)
    web_assets_dir = os.path.abspath(os.path.join(base_dir, '..', 'rxshield-web', 'public', 'assets'))
    os.makedirs(web_assets_dir, exist_ok=True)
    web_db_assets_path = os.path.join(web_assets_dir, 'rxshield_core.db')
    shutil.copy2(db_path, web_db_assets_path)
    print(f"Copied database to web assets: {web_db_assets_path}")

    web_db_dir = os.path.abspath(os.path.join(base_dir, '..', 'rxshield-web', 'public', 'database'))
    os.makedirs(web_db_dir, exist_ok=True)
    web_db_path = os.path.join(web_db_dir, 'rxshield_core.db')
    shutil.copy2(db_path, web_db_path)
    print(f"Copied database to web database folder: {web_db_path}")
    print("Database boundary copy completed successfully.")

if __name__ == '__main__':
    compile_database()
