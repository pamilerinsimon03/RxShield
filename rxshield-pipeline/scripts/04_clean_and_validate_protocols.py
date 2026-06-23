import re
import os
import pandas as pd

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

def find_best_eml_match(candidate, eml_names):
    """
    Cross-references candidate name with EML names.
    Supports exact match and fuzzy Levenshtein repair (dist <= 2, conf > 90% or dist == 1).
    """
    if candidate in eml_names:
        return candidate, 0, 1.0
        
    best_match = None
    min_dist = 999
    max_confidence = 0.0
    
    for eml_name in eml_names:
        dist = levenshtein_distance(candidate, eml_name)
        if dist <= 2:
            max_len = max(len(candidate), len(eml_name))
            confidence = 1.0 - (dist / max_len)
            if dist == 1 or confidence > 0.90:
                if dist < min_dist:
                    min_dist = dist
                    best_match = eml_name
                    max_confidence = confidence
                elif dist == min_dist and confidence > max_confidence:
                    best_match = eml_name
                    max_confidence = confidence
                    
    return best_match, min_dist, max_confidence

def convert_to_mg(val_str, unit):
    """
    Converts grams (G) to milligrams (MG) and keeps MG as float.
    Returns None for non-convertible units (ML, IU) as they are not MG.
    """
    try:
        val = float(val_str)
    except ValueError:
        return None
    unit = unit.upper()
    if unit == 'G':
        return val * 1000.0
    elif unit == 'MG':
        return val
    return None

def parse_thresholds(block_text, dose_from_line):
    """
    Extracts single dose, daily dose, duration, and safety checks from block text.
    """
    max_single_dose_mg = None
    max_daily_dose_mg = None
    max_duration_days = None
    
    # Clean text: replace multi-spaces and newlines
    text = " ".join(block_text.upper().split())

    # Check dose from line first for single dose
    if dose_from_line:
        m = re.match(r'^(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)$', dose_from_line.upper())
        if m:
            max_single_dose_mg = convert_to_mg(m.group(1), m.group(2))

    # Daily dose patterns (explicit Max/not exceeding)
    daily_patterns = [
        r'MAX(?:\.|IMUM)?\s*:\s*(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)\s*DAILY',
        r'NOT\s+EXCEEDING\s*(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)/DAY',
        r'NOT\s+EXCEEDING\s*(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)\s*DAILY',
        r'MAX(?:\.|IMUM)?\s+(?:DAILY\s+)?(?:DOSE\s+)?(?:OF\s+)?(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)',
        r'MAX(?:\.|IMUM)?\s*(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)\s*DAILY',
        r'(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)/DAY',
    ]

    for pat in daily_patterns:
        m = re.search(pat, text)
        if m:
            converted = convert_to_mg(m.group(1), m.group(2))
            if converted:
                max_daily_dose_mg = converted
                break

    # If single dose is still None, search for range or single value in the block
    if max_single_dose_mg is None:
        # Range check e.g. "10 - 20 MG" or "10-20 MG"
        range_match = re.search(r'(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)', text)
        if range_match:
            max_single_dose_mg = convert_to_mg(range_match.group(2), range_match.group(3))
        else:
            # Single value check
            single_patterns = [
                r'(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)\s*STAT\b',
                r'(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)\s*SINGLE\s*DOSE\b',
                r'SINGLE\s+DOSE\s+OF\s+(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)\b',
                r'MAX(?:\.|IMUM)?\s+SINGLE\s+DOSE\s*(?:OF\s+)?(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)\b',
                r'(\d+(?:\.\d+)?)\s*(MG|G|ML|IU)',
            ]
            for pat in single_patterns:
                m = re.search(pat, text)
                if m:
                    converted = convert_to_mg(m.group(1), m.group(2))
                    if converted:
                        max_single_dose_mg = converted
                        break

    # If daily dose is still None, look for frequency multiplier
    if max_daily_dose_mg is None and max_single_dose_mg is not None:
        mult = None
        if re.search(r'\b(?:THREE\s+TIMES\s+DAILY|TDS|8\s+HOURLY|3\s+TIMES\s+DAILY|8-HOURLY)\b', text):
            mult = 3
        elif re.search(r'\b(?:TWICE\s+DAILY|BD|12\s+HOURLY|2\s+TIMES\s+DAILY|12-HOURLY)\b', text):
            mult = 2
        elif re.search(r'\b(?:FOUR\s+TIMES\s+DAILY|QDS|6\s+HOURLY|4\s+TIMES\s+DAILY|6-HOURLY)\b', text):
            mult = 4
        elif re.search(r'\b(?:ONCE\s+DAILY|DAILY|OD|24\s+HOURLY|24-HOURLY|NOCTE|MANE|NIGHT|MORNING)\b', text):
            mult = 1
            
        if mult is not None:
            max_daily_dose_mg = max_single_dose_mg * mult

    # Duration patterns
    duration_patterns = [
        (r'\bFOR\s+(\d+)\s+DAYS\b', 1),
        (r'\bUP\s+TO\s+(\d+)\s+WEEKS\b', 7),
        (r'\bFOR\s+(\d+)\s+WEEKS\b', 7),
        (r'\bUP\s+TO\s+(\d+)\s+DAYS\b', 1),
        (r'\b(\d+)\s+DAYS\s+COURSE\b', 1),
        (r'\b(\d+)-DAY\b', 1),
        (r'\b(\d+)-WEEK\b', 7),
    ]

    for pat, mult_val in duration_patterns:
        m = re.search(pat, text)
        if m:
            max_duration_days = int(m.group(1)) * mult_val
            break

    # Demographic flags
    requires_pregnancy_check = 0
    requires_renal_check = 0
    
    if "PREGNANCY" in text or "PREGNANT" in text:
        requires_pregnancy_check = 1
    if "RENAL" in text or "HEPATIC" in text or "KIDNEY" in text or "LIVER" in text:
        requires_renal_check = 1
        
    if "CONTRAINDICATED" in text:
        if "PREGNAN" in text:
            requires_pregnancy_check = 1
        if "RENAL" in text or "HEPAT" in text or "KIDNEY" in text or "LIVER" in text:
            requires_renal_check = 1

    return max_single_dose_mg, max_daily_dose_mg, max_duration_days, requires_pregnancy_check, requires_renal_check

def clean_and_validate():
    # Base paths
    eml_path = 'data/processed/eml_normalized.csv'
    raw_path = 'data/processed/nstg_raw_ocr_output.txt'
    clean_out_path = 'data/processed/nstg_protocols_clean.csv'
    quarantine_path = 'data/processed/parsing_quarantine.log'

    print("Step 1: Loading EML reference dictionary...")
    eml_df = pd.read_csv(eml_path)
    eml_names = set(eml_df['Medicine'].dropna().unique())
    print(f"Loaded {len(eml_names)} unique EML medication generic names.")

    print("\nStep 2: Reading NSTG raw OCR flat text...")
    with open(raw_path, 'r', encoding='utf-8') as f:
        raw_lines = f.readlines()
    print(f"Loaded {len(raw_lines)} raw OCR text lines.")

    print("\nStep 3: Executing standalone bullet line merging...")
    processed_lines = []
    i = 0
    while i < len(raw_lines):
        line = raw_lines[i].strip()
        if line == '-':
            j = i + 1
            while j < len(raw_lines) and not raw_lines[j].strip():
                j += 1
            if j < len(raw_lines):
                next_line = raw_lines[j].strip()
                processed_lines.append("- " + next_line)
                i = j + 1
            else:
                processed_lines.append("-")
                i = j
        else:
            processed_lines.append(raw_lines[i].rstrip())
            i += 1
    print(f"Merged layout anomalies. Total lines now: {len(processed_lines)}.")

    # Stateful parser trackers
    page_num = 13
    current_chapter_num = None
    current_chapter_title = ""
    current_disorder = None
    candidates_disorder = []
    
    SUBSECTION_HEADINGS = {
        "INTRODUCTION", "AETIOLOGY", "CLINICAL FEATURES", "DIAGNOSTIC CRITERIA",
        "DIFFERENTIAL DIAGNOSES", "INVESTIGATIONS", "TREATMENT", 
        "NON-PHARMACOLOGICAL TREATMENT", "PHARMACOLOGICAL TREATMENT",
        "DRUG TREATMENT", "DRUG THERAPY", "PREVENTION", "COMPLICATIONS",
        "MANAGEMENT", "GENERAL MEASURES"
    }

    helpers = {"ORAL", "IV", "SLOW", "TABLET", "INTRAVENOUS", "SUBCUTANEOUS", "IM", "INTRAMUSCULAR", "CAPSULE", "LIQUID", "SYRUP", "DROPS", "ROUTE"}

    page_pattern = re.compile(r'^--- PAGE (\d+) ---$')
    chapter_pattern = re.compile(r'^CHAPTER\s+(\d+)\s*:?\s*(.*)$', re.IGNORECASE)
    drug_pattern = re.compile(r'^-\s*([A-Z\s+\/\-]+)\s*(\d+(?:\.\d+)?\s*(?:MG|G|ML|IU))?.*$', re.IGNORECASE)

    raw_parsed_protocols = []
    quarantined_logs = []
    fuzzy_repair_count = 0

    active_block = None

    def process_block(block):
        nonlocal fuzzy_repair_count
        if not block:
            return
        
        raw_name = block["raw_name"]
        
        # Dosage separation
        dosage_sep_match = re.search(r'\s+(\d+(?:\.\d+)?\s*(?:MG|G|ML|IU))$', raw_name)
        if dosage_sep_match:
            raw_name = raw_name[:dosage_sep_match.start()].strip()
            
        words = raw_name.split()
        cleaned_words = [w for w in words if w not in helpers]
        candidate_name = " ".join(cleaned_words)
        
        if not candidate_name:
            quarantined_logs.append(f"[EMPTY_NAME] First Line: '{block['first_line']}' | Citation: {block['citation']}")
            return
            
        best_match, min_dist, max_confidence = find_best_eml_match(candidate_name, eml_names)
        
        if not best_match:
            quarantined_logs.append(f"[NO_MATCH] Candidate '{candidate_name}' (raw line: '{block['first_line']}') failed to cross-reference to EML. Citation: {block['citation']}")
            return

        if min_dist > 0:
            fuzzy_repair_count += 1
            # Log fuzzy repair details
            print(f"  Fuzzy Repair: '{candidate_name}' -> '{best_match}' (dist: {min_dist}, conf: {max_confidence:.2f})")

        # Parse block text for dosages
        block_text = " ".join(block["lines"])
        single_dose, daily_dose, duration, preg_flag, renal_flag = parse_thresholds(block_text, block["dose_from_line"])

        # Check if we failed to yield any parseable threshold
        if single_dose is None and daily_dose is None:
            quarantined_logs.append(f"[NO_DOSE] Candidate '{best_match}' (raw line: '{block['first_line']}') failed to yield a parseable single or daily dose threshold. Citation: {block['citation']}")
            return

        raw_parsed_protocols.append({
            "generic_name": best_match,
            "max_single_dose_mg": single_dose,
            "max_daily_dose_mg": daily_dose,
            "max_duration_days": duration,
            "requires_pregnancy_check": preg_flag,
            "requires_renal_check": renal_flag,
            "guideline_citation": block["citation"]
        })

    print("\nStep 4: Running stateful parsing loop...")
    for line in processed_lines:
        line_str = line.strip()
        if not line_str:
            continue

        # Page match check
        page_match = page_pattern.match(line_str)
        if page_match:
            page_num = int(page_match.group(1))
            continue

        # Chapter match check
        chapter_match = chapter_pattern.match(line_str)
        if chapter_match:
            if active_block:
                process_block(active_block)
                active_block = None
            current_chapter_num = int(chapter_match.group(1))
            current_chapter_title = chapter_match.group(2).strip()
            current_disorder = None
            candidates_disorder = []
            continue

        # Subsection Heading check to update current disorder statefully
        upper_line = line_str.upper()
        if upper_line in SUBSECTION_HEADINGS:
            if active_block:
                process_block(active_block)
                active_block = None
            
            # Update disorder name when entering a new subsection
            if upper_line == "INTRODUCTION" or current_disorder is None:
                for cand in reversed(candidates_disorder):
                    cand_clean = cand.strip()
                    if not cand_clean:
                        continue
                    # Check if it looks like a valid heading
                    if len(cand_clean) < 60 and not cand_clean[-1] in {'.', ',', ';', ':', ')'}:
                        current_disorder = cand_clean
                        break
            continue

        # Check if this line is a potential disorder title candidate
        is_num = line_str.isdigit()
        is_roman = bool(re.match(r'^[ivxldcmIVXLDCM]+$', line_str))
        is_bullet = line_str.startswith('-') or line_str.startswith('*') or line_str.startswith('¢') or line_str.startswith('—')
        
        if not is_num and not is_roman and not is_bullet and not line_str.startswith('SECTION'):
            if current_chapter_num is not None and not current_chapter_title and line_str.isupper():
                current_chapter_title = line_str
            else:
                candidates_disorder.append(line_str)

        # Drug prescription line match check
        drug_match = drug_pattern.match(line_str)
        if drug_match:
            if active_block:
                process_block(active_block)
            
            raw_name = drug_match.group(1).strip().upper()
            dose_val_str = drug_match.group(2)
            
            # Format the citation string
            citation = f"Chapter {current_chapter_num or 0}, Page {page_num}"
            active_block = {
                "raw_name": raw_name,
                "dose_from_line": dose_val_str,
                "first_line": line_str,
                "lines": [line_str],
                "citation": citation
            }
        else:
            if active_block:
                active_block["lines"].append(line_str)

    # Process the final block at EOF
    if active_block:
        process_block(active_block)

    print(f"\nParsing Loop Completed.")
    print(f"Total raw matched candidates: {len(raw_parsed_protocols) + len(quarantined_logs)}")
    print(f"Successfully validated & matched candidates: {len(raw_parsed_protocols)}")
    print(f"Quarantined candidates: {len(quarantined_logs)}")
    print(f"Fuzzy name repairs performed: {fuzzy_repair_count}")

    print("\nStep 5: Aggregating profiles by generic_name for database unique constraint contract...")
    if raw_parsed_protocols:
        df = pd.DataFrame(raw_parsed_protocols)
        
        # Unify and aggregate duplicate generic_name profiles
        agg_funcs = {
            'max_single_dose_mg': 'max',
            'max_daily_dose_mg': 'max',
            'max_duration_days': 'max',
            'requires_pregnancy_check': 'max',
            'requires_renal_check': 'max',
            'guideline_citation': lambda x: '; '.join(sorted(list(set(x))))
        }
        
        df_agg = df.groupby('generic_name', as_index=False).agg(agg_funcs)
        
        # Force demographic flags for known high-risk medications (e.g. METHOTREXATE)
        for idx, row in df_agg.iterrows():
            gname = str(row['generic_name']).upper()
            if 'METHOTREXATE' in gname:
                df_agg.at[idx, 'requires_pregnancy_check'] = 1
                df_agg.at[idx, 'requires_renal_check'] = 1

        # Cast demographic check flags to strict integers 0 or 1
        df_agg['requires_pregnancy_check'] = df_agg['requires_pregnancy_check'].astype(int)
        df_agg['requires_renal_check'] = df_agg['requires_renal_check'].astype(int)
        
        # Cast duration to nullable Int64 to avoid float formatting in CSV
        df_agg['max_duration_days'] = df_agg['max_duration_days'].astype('Int64')
        
        # Save aggregated CSV
        df_agg.to_csv(clean_out_path, index=False, encoding='utf-8')
        print(f"Saved {len(df_agg)} unique clinical guideline models to '{clean_out_path}'.")
    else:
        # Save empty template to clean_out_path to prevent downstream failures
        cols = ['generic_name', 'max_single_dose_mg', 'max_daily_dose_mg', 'max_duration_days', 'requires_pregnancy_check', 'requires_renal_check', 'guideline_citation']
        pd.DataFrame(columns=cols).to_csv(clean_out_path, index=False, encoding='utf-8')
        print(f"Saved empty template CSV to '{clean_out_path}' (zero records matched).")

    print("\nStep 6: Writing quarantine inspection log...")
    with open(quarantine_path, 'w', encoding='utf-8') as f:
        for q in quarantined_logs:
            f.write(q + '\n')
    print(f"Saved {len(quarantined_logs)} quarantine inspection records to '{quarantine_path}'.")
    
    print("\nUnit 14 execution completed successfully.")

if __name__ == '__main__':
    clean_and_validate()
