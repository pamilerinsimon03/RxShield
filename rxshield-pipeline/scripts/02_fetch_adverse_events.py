import os
import io
import re
import csv
import json
import zipfile
import itertools
import requests
import urllib3

# Suppress InsecureRequestWarning when verifying SSL is disabled
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Configurable execution parameters
LIMIT_PARTITIONS = None         # Limit number of partitions processed to prevent network timeouts (set to None for all 2026)
FREQUENCY_THRESHOLD = 50     # Threshold count. Evict pairs occurring <= this number
MANIFEST_URL = "https://api.fda.gov/download.json"

def ensure_directory_structure():
    """Verify and initialize the target processed data directory."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    processed_dir = os.path.join(base_dir, 'data', 'processed')
    if not os.path.exists(processed_dir):
        print(f"Creating directory: {processed_dir}")
        os.makedirs(processed_dir)

def process_event(event_obj, freq_dict):
    """
    Extract and process a single adverse event record.
    Identifies concurrent generic medications and tracks their co-occurrence.
    """
    patient = event_obj.get('patient', {})
    if not patient:
        return

    drugs = patient.get('drug', [])
    reactions = patient.get('reaction', [])

    # Skip if no concurrent drugs or no reaction symptoms are present
    if not drugs or not reactions:
        return

    # Verify at least one MedDRA reaction term exists
    has_reaction = False
    for r in reactions:
        if r.get('reactionmeddrapt'):
            has_reaction = True
            break
            
    if not has_reaction:
        return

    # Extract unique, cleaned generic names from drugs
    gen_names = set()
    for d in drugs:
        openfda = d.get('openfda')
        if openfda and 'generic_name' in openfda:
            gen_names_list = openfda['generic_name']
            if isinstance(gen_names_list, list) and gen_names_list:
                # Use the primary generic name (first entry)
                primary_name = gen_names_list[0]
                # Clean: strip spaces, uppercase, collapse double spaces
                cleaned = " ".join(primary_name.strip().upper().split())
                if cleaned:
                    gen_names.add(cleaned)

    # We need at least 2 unique medications to form a co-occurrence pair
    if len(gen_names) < 2:
        return

    # Alphabetically sorted combinations to ensure deterministic ordering (DrugA < DrugB)
    sorted_names = sorted(list(gen_names))
    for drug_a, drug_b in itertools.combinations(sorted_names, 2):
        pair = (drug_a, drug_b)
        freq_dict[pair] = freq_dict.get(pair, 0) + 1

def main():
    ensure_directory_structure()
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_csv_path = os.path.join(base_dir, 'data', 'processed', 'openfda_interactions.csv')

    print(f"Fetching openFDA manifest from: {MANIFEST_URL}")
    try:
        response = requests.get(MANIFEST_URL, verify=False, timeout=10)
        response.raise_for_status()
    except (requests.exceptions.ConnectionError, requests.exceptions.HTTPError, requests.exceptions.Timeout) as e:
        print(f"Network error trying to contact openFDA: {e}")
        if os.path.exists(output_csv_path):
            print(f"[Offline Fallback] Reusing existing aggregated interactions file at: {output_csv_path}")
            return
        else:
            print("CRITICAL ERROR: No internet connection and no pre-existing interactions file found.")
            raise e
            
    manifest_data = response.json()

    # Extract partition list
    partitions = manifest_data.get('results', {}).get('drug', {}).get('event', {}).get('partitions', [])
    print(f"Total partitions discovered in manifest: {len(partitions)}")

    # Filter for the most recent 2026 data partitions (as approved in design specs)
    recent_partitions = []
    for p in partitions:
        disp_name = p.get('display_name', '')
        file_url = p.get('file', '')
        if '2026' in disp_name or '2026' in file_url:
            recent_partitions.append(p)
            
    recent_partitions = sorted(recent_partitions, key=lambda x: x.get('file', ''))
    print(f"Total filtered recent (2026) partitions: {len(recent_partitions)}")

    # Apply partition limit for local dev speed/time bounds
    if LIMIT_PARTITIONS is not None:
        print(f"Applying partition limit: processing the last {LIMIT_PARTITIONS} partitions.")
        recent_partitions = recent_partitions[-LIMIT_PARTITIONS:]
    else:
        print("Processing all filtered 2026 partitions (no limit active).")

    freq_dict = {}
    processed_count = 0

    # Stream ingestion & line-by-line processing loop
    for p in recent_partitions:
        url = p['file']
        size = p.get('size_mb', 'unknown')
        print(f"Streaming partition: {p.get('display_name')} ({size} MB) ...")
        
        try:
            # Stream partition zip archive
            p_res = requests.get(url, stream=True, verify=False)
            p_res.raise_for_status()
            
            # Read the zip archive directly into a memory buffer
            zip_buffer = io.BytesIO(p_res.content)
            
            with zipfile.ZipFile(zip_buffer) as z:
                filename = z.namelist()[0]
                # Open zip content as a streaming file handler (decodes compression chunk-by-chunk)
                with z.open(filename) as f:
                    in_results = False
                    event_lines = []
                    
                    for line in f:
                        line_str = line.decode('utf-8')
                        
                        # Find start of result array
                        if not in_results:
                            if '"results": [' in line_str:
                                in_results = True
                            continue
                        
                        # Event records are pretty-printed with exactly 4 spaces and a brace
                        if line_str.startswith("    {"):
                            event_lines = [line_str]
                        elif event_lines:
                            event_lines.append(line_str)
                            # Detect the end of a single event object
                            if line_str.startswith("    }") or line_str.startswith("    },"):
                                event_json_str = "".join(event_lines).strip()
                                # Clean trailing comma for standard JSON loading
                                if event_json_str.endswith(","):
                                    event_json_str = event_json_str[:-1]
                                    
                                try:
                                    event_obj = json.loads(event_json_str)
                                    process_event(event_obj, freq_dict)
                                    processed_count += 1
                                except Exception:
                                    pass
                                event_lines = []
                                
        except Exception as e:
            print(f"Error downloading or parsing partition {url}: {e}")

    print(f"Total events parsed across partitions: {processed_count}")
    print(f"Total unique drug-drug interaction pairs aggregated: {len(freq_dict)}")

    # Evict low-frequency pairs
    print(f"Filtering interactions with frequency threshold > {FREQUENCY_THRESHOLD}...")
    high_signal_interactions = []
    for (drug_a, drug_b), count in freq_dict.items():
        if count > FREQUENCY_THRESHOLD:
            high_signal_interactions.append({
                'generic_name_a': drug_a,
                'generic_name_b': drug_b,
                'severity': 'WARNING'
            })

    print(f"Retained high-signal interaction pairs count: {len(high_signal_interactions)}")

    # Write to target CSV
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_csv_path = os.path.join(base_dir, 'data', 'processed', 'openfda_interactions.csv')
    print(f"Writing to: {output_csv_path}")

    with open(output_csv_path, mode='w', newline='', encoding='utf-8') as f_out:
        writer = csv.DictWriter(f_out, fieldnames=['generic_name_a', 'generic_name_b', 'severity'])
        writer.writeheader()
        writer.writerows(high_signal_interactions)

    print("openFDA extraction module completed successfully.")

if __name__ == '__main__':
    main()
