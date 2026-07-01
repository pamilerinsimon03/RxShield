import os
import re
import zipfile
import xml.etree.ElementTree as ET
import pandas as pd

def ensure_directory_structure():
    """Verify and initialize the isolated data directory hierarchy."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    directories = [
        os.path.join(base_dir, 'data', 'raw'),
        os.path.join(base_dir, 'data', 'processed'),
        os.path.join(base_dir, 'data', 'output')
    ]
    for directory in directories:
        if not os.path.exists(directory):
            print(f"Creating directory: {directory}")
            os.makedirs(directory)
        else:
            print(f"Directory exists: {directory}")

def parse_xlsx_to_matrix(file_path):
    """
    Parse Excel file (.xlsx) sheet1 using standard library XML parsing to avoid
    dependency bloat (e.g. openpyxl). Returns a 2D matrix of sheet cell values.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Source file not found at: {file_path}")

    print(f"Reading XML structure from XLSX container: {file_path}")
    with zipfile.ZipFile(file_path, 'r') as zip_ref:
        shared_strings = []
        if 'xl/sharedStrings.xml' in zip_ref.namelist():
            ss_content = zip_ref.read('xl/sharedStrings.xml')
            ss_root = ET.fromstring(ss_content)
            ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for t in ss_root.findall('.//ns:t', ns):
                shared_strings.append(t.text or '')
        
        sheet_content = zip_ref.read('xl/worksheets/sheet1.xml')
        sheet_root = ET.fromstring(sheet_content)
        ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        
        grid = {}
        max_row = 1
        
        cell_ref_re = re.compile(r'^([A-Z]+)(\d+)$')
        
        def col_letter_to_index(col_str):
            exp = 0
            idx = 0
            for char in reversed(col_str):
                idx += (ord(char) - 64) * (26 ** exp)
                exp += 1
            return idx - 1

        for cell in sheet_root.findall('.//ns:c', ns):
            ref = cell.get('r')
            if not ref:
                continue
            match = cell_ref_re.match(ref)
            if not match:
                continue
            col_str, row_str = match.groups()
            row_idx = int(row_str)
            col_idx = col_letter_to_index(col_str)
            
            if row_idx > max_row:
                max_row = row_idx
                
            cell_type = cell.get('t')
            val_elem = cell.find('ns:v', ns)
            val = val_elem.text if val_elem is not None else ''
            
            if cell_type == 's':
                val = shared_strings[int(val)] if val else ''
            elif cell_type == 'inlineStr':
                is_elem = cell.find('ns:is', ns)
                if is_elem is not None:
                    t_elem = is_elem.find('ns:t', ns)
                    if t_elem is not None:
                        val = t_elem.text or ''
            
            if row_idx not in grid:
                grid[row_idx] = {}
            grid[row_idx][col_idx] = val
            
        # Extract first 7 columns (A to G)
        max_col = 7
        matrix = []
        for r in range(1, max_row + 1):
            row_data = grid.get(r, {})
            row_list = [row_data.get(c, '') for c in range(max_col)]
            matrix.append(row_list)
            
        return matrix

def sanitize_text(val):
    """Sanitize string values: strip spaces, force uppercase, remove duplicate inner spaces."""
    if val is None:
        return ''
    val_str = str(val).strip().upper()
    return re.sub(r'\s+', ' ', val_str)

def main():
    """
    Orchestrate the ingestion of raw EML Excel data.
    
    Workflow:
    1. Verify and initialize the data directory structure.
    2. Parse the raw Excel file into a cell matrix.
    3. Load data into a DataFrame and filter for active ('Added') rows.
    4. Restructure, sanitize, and validate columns against the target schema.
    5. Serialize the clean dataset to a normalized CSV.
    """
    ensure_directory_structure()
    
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    raw_file_path = os.path.join(base_dir, 'data', 'raw', 'eml_export.xlsx')
    output_file_path = os.path.join(base_dir, 'data', 'processed', 'eml_normalized.csv')
    
    matrix = parse_xlsx_to_matrix(raw_file_path)
    
    headers = matrix[0]
    data_rows = matrix[1:]
    
    print(f"Loaded {len(data_rows)} raw data rows with headers: {headers}")
    df = pd.DataFrame(data_rows, columns=headers)
    
    print("Filtering rows where Status is 'Added'...")
    df = df[df['Status'] == 'Added']
    print(f"Filtered to {len(df)} 'Added' rows.")
    
    print("Retaining core metadata columns...")
    df = df[['Medicine name', 'Formulations', 'ATC codes']]
    
    df = df.rename(columns={
        'Medicine name': 'Medicine',
        'Formulations': 'Strength/Form',
        'ATC codes': 'ATC Code'
    })
    
    for col in df.columns:
        df[col] = df[col].fillna('').astype(str)
        
    print("Applying text sanitization (upper, strip, duplicate space compression)...")
    df['Medicine'] = df['Medicine'].apply(sanitize_text)
    df['ATC Code'] = df['ATC Code'].apply(sanitize_text)
    
    print(f"Serializing clean dataset to: {output_file_path}")
    df.to_csv(output_file_path, index=False, encoding='utf-8')
    print("Ingestion script completed successfully.")

if __name__ == '__main__':
    main()
