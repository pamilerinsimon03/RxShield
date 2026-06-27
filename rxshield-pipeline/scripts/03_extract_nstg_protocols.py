import os
# pyrefly: ignore [missing-import]
import pymupdf

# Configuration constants
START_PAGE = 13      # 1-indexed page number to start extraction from
END_PAGE = 599       # 1-indexed page number to end extraction at (inclusive)
LIMIT_PAGES = None      # Configurable limit to process a small slice during fast validation (set to None for all pages)
OUTPUT_FILENAME = "nstg_raw_ocr_output.txt"

def ensure_directory_structure():
    """Verify and initialize the target processed data directory."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    processed_dir = os.path.join(base_dir, 'data', 'processed')
    if not os.path.exists(processed_dir):
        print(f"Creating directory: {processed_dir}")
        os.makedirs(processed_dir)

def main():
    ensure_directory_structure()
    
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Check both potential PDF filenames (with space and URL-encoded space)
    pdf_path_space = os.path.join(base_dir, 'data', 'raw', 'Nigeria Standard Treatment Guidelines 2022.pdf')
    pdf_path_url = os.path.join(base_dir, 'data', 'raw', 'Nigeria%20Standard%20Treatment%20Guidelines%202022.pdf')
    
    if os.path.exists(pdf_path_space):
        pdf_path = pdf_path_space
    elif os.path.exists(pdf_path_url):
        pdf_path = pdf_path_url
    else:
        raise FileNotFoundError(f"Source PDF file not found. Checked: {pdf_path_space} and {pdf_path_url}")

    print(f"Successfully located PDF scan at: {pdf_path}")
    print("Opening PDF layout stream...")
    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)
    print(f"PDF contains {total_pages} total pages.")

    # Serialize output raw text path
    output_file_path = os.path.join(base_dir, 'data', 'processed', OUTPUT_FILENAME)
    
    # Calculate 0-based indices for extraction range
    start_idx = max(0, START_PAGE - 1)
    end_idx = min(total_pages - 1, END_PAGE - 1)
    
    try:
        # Test if Tesseract OCR is available by doing a fast test on the first page
        test_page = doc[start_idx]
        test_ocr = test_page.get_textpage_ocr(language="eng", dpi=72)
        test_page.get_text(textpage=test_ocr)
        print("Tesseract OCR is available. Proceeding with full document extraction...")
    except Exception as e:
        print(f"Tesseract OCR is not available or failed: {e}")
        if os.path.exists(output_file_path):
            print(f"[Offline Fallback] Reusing existing OCR text file at: {output_file_path}")
            return
        else:
            raise RuntimeError("Tesseract OCR failed and no pre-existing text file was found.") from e

    pages_to_process = list(range(start_idx, end_idx + 1))
    
    if LIMIT_PAGES is not None:
        print(f"Applying page limit: processing only the first {LIMIT_PAGES} pages of the range.")
        pages_to_process = pages_to_process[:LIMIT_PAGES]
    else:
        print(f"Processing all pages in range {START_PAGE} to {END_PAGE} ({len(pages_to_process)} pages total).")

    output_lines = []
    
    for idx in pages_to_process:
        page_num = idx + 1
        print(f"Processing Page {page_num}/{total_pages} via Tesseract OCR (300 DPI)...")
        
        # Load the page
        page = doc[idx]
        
        try:
            # Instantiate PyMuPDF's Tesseract handler with English language pack at 300 DPI
            text_page_ocr = page.get_textpage_ocr(
                flags=pymupdf.TEXT_PRESERVE_WHITESPACE, 
                language="eng", 
                dpi=300
            )
            raw_extracted_text = page.get_text(textpage=text_page_ocr)
            
            # Format output block with page separator
            output_lines.append(f"--- PAGE {page_num} ---\n")
            output_lines.append(raw_extracted_text)
            output_lines.append("\n")
            
        except Exception as e:
            print(f"Error performing OCR on Page {page_num}: {e}")
            output_lines.append(f"--- PAGE {page_num} ---\n")
            output_lines.append(f"[OCR ERROR: {e}]\n\n")

    # Serialize output raw text
    output_file_path = os.path.join(base_dir, 'data', 'processed', OUTPUT_FILENAME)
    print(f"Writing raw OCR text to: {output_file_path}")
    
    with open(output_file_path, 'w', encoding='utf-8') as f_out:
        f_out.writelines(output_lines)
        
    print("Local NSTG Guideline OCR Extraction completed successfully.")

if __name__ == '__main__':
    main()
