import os
import csv
import random
import requests
import ssl
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

# Bypass SSL context verification for HF/Google font downloading
ssl._create_default_https_context = ssl._create_unverified_context

def download_fonts(fonts_dir):
    os.makedirs(fonts_dir, exist_ok=True)
    font_urls = {
        "Caveat": "https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf",
        "DancingScript": "https://github.com/google/fonts/raw/main/ofl/dancingscript/DancingScript%5Bwght%5D.ttf",
        "ArchitectsDaughter": "https://github.com/google/fonts/raw/main/ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf",
        "ReenieBeanie": "https://github.com/google/fonts/raw/main/ofl/reeniebeanie/ReenieBeanie.ttf",
        "Redressed": "https://github.com/google/fonts/raw/main/apache/redressed/Redressed-Regular.ttf"
    }
    
    downloaded_paths = []
    for font_name, url in font_urls.items():
        font_path = os.path.join(fonts_dir, f"{font_name}.ttf")
        if not os.path.exists(font_path):
            print(f"Downloading {font_name} font from {url}...")
            try:
                r = requests.get(url, verify=False, timeout=15)
                if r.status_code == 200:
                    with open(font_path, 'wb') as f:
                        f.write(r.content)
                    print(f"Successfully downloaded {font_name}")
                else:
                    print(f"Failed to download {font_name}: HTTP status {r.status_code}")
            except Exception as e:
                print(f"Error downloading {font_name}: {e}")
        
        if os.path.exists(font_path):
            downloaded_paths.append(font_path)
            
    return downloaded_paths

def load_words(processed_dir):
    # Load normalized EML medicines
    medicines = set()
    eml_csv = os.path.join(processed_dir, "eml_normalized.csv")
    if os.path.exists(eml_csv):
        with open(eml_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                med = row.get("Medicine", "").strip()
                if med:
                    # Strip any parentheses contents
                    med_clean = med.split("(")[0].strip()
                    medicines.add(med_clean)
                    
    # Load NSTG generic names
    nstg_csv = os.path.join(processed_dir, "nstg_protocols_clean.csv")
    if os.path.exists(nstg_csv):
        with open(nstg_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                med = row.get("generic_name", "").strip()
                if med:
                    medicines.add(med)
                    
    # Popular Nigerian brand names as manual additions
    nigerian_brands = [
        "EMZOR", "PANADOL", "AMOXIL", "AUGMENTIN", "TYLENOL", "LIPITOR", "LASIX", "LOXAGYL",
        "PEPTACID", "NEIMETH", "M&B", "ROCEPHIN", "CIPRO", "ZINNAT", "VENTOLIN", "FLAGYL",
        "METHOTREXATE", "GLOW", "COTRIMOXAZOLE", "IMATINIB"
    ]
    for brand in nigerian_brands:
        medicines.add(brand)
        
    return sorted(list(medicines))

def generate_prescription_strings(medicines):
    strengths = [
        "500mg", "1g", "250mg", "10mg", "40mg", "5mg", "625mg", "2gm", "100mg", 
        "7.5mg", "150mg", "120mg", "250mg/5ml", "125mg/5ml", "50mg/ml", "100mcg"
    ]
    
    frequencies = [
        "TDS", "BD", "Daily", "OM", "ON", "PRN", "1+1+1", "1+0+1", "0+0+1", 
        "2+2+2", "1/2 tab", "1-0-1", "1/2 tab TDS", "1 tab BD"
    ]
    
    combined_drugs = [
        "AMOXICILLIN + CLAVULANIC ACID", "CO-TRIMOXAZOLE 480mg + 120mg", 
        "ARTEMETHER + LUMEFANTRINE", "SULFADOXINE + PYRIMETHAMINE",
        "IPRATROPIUM + SALBUTAMOL"
    ]
    
    # We construct a synthetic text label
    text_labels = []
    
    # Add combinations
    for _ in range(5000):
        med = random.choice(medicines)
        strength = random.choice(strengths)
        freq = random.choice(frequencies)
        
        # Build variations
        pattern = random.randint(1, 6)
        if pattern == 1:
            text = f"{med} {strength}"
        elif pattern == 2:
            text = f"{med} {strength} {freq}"
        elif pattern == 3:
            text = f"{med} {freq}"
        elif pattern == 4:
            text = f"{strength} {freq}"
        elif pattern == 5:
            text = f"{med}"
        else:
            text = f"{strength}"
        text_labels.append(text)
        
    # Add combination drug names
    for _ in range(2500):
        comb = random.choice(combined_drugs)
        freq = random.choice(frequencies)
        if random.random() > 0.5:
            text = f"{comb} {freq}"
        else:
            text = comb
        text_labels.append(text)
        
    # Add raw slash and plus symbols and frequency shorthand
    for _ in range(1500):
        med = random.choice(medicines)
        strength = random.choice(strengths)
        if "/" in strength or "+" in med:
            text = f"{med} {strength}"
        else:
            # Explicitly force a slash or plus
            text = random.choice([
                f"{med} 500mg/5ml",
                f"{med} + Clarithromycin",
                f"1/2 tab TDS",
                f"1/4 tab BD",
                f"250mg + 125mg",
                f"1+1+1/2",
                f"500mg/10ml"
            ])
        text_labels.append(text)
        
    # Shuffle and trim to exactly 9000
    random.shuffle(text_labels)
    return text_labels[:9000]

def add_noise_and_deform(image):
    # Convert image to numpy array
    img_data = np.array(image)
    h, w = img_data.shape
    
    # Add Gaussian/Salt-and-Pepper noise
    noise_level = random.uniform(0.005, 0.02)
    noise = np.random.randn(h, w) * 255 * noise_level
    img_data = np.clip(img_data + noise, 0, 255).astype(np.uint8)
    
    # Return as Pillow Image
    image = Image.fromarray(img_data)
    
    # Random Gaussian Blur
    blur_radius = random.uniform(0.3, 1.2)
    image = image.filter(ImageFilter.GaussianBlur(blur_radius))
    
    return image

def render_text_image(text, font_paths, output_path):
    # Target image size: 128x512
    bg_color = random.randint(235, 255) # Light background
    img = Image.new('L', (512, 128), color=bg_color)
    draw = ImageDraw.Draw(img)
    
    # Select random font and size
    font_path = random.choice(font_paths)
    font_size = random.randint(26, 46)
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception:
        font = ImageFont.load_default()
        
    # Get text size
    # Check text bbox (supported in newer Pillow)
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        # Fallback for older Pillow
        text_w, text_h = draw.textsize(text, font=font)
        
    # Adjust font size if text is too wide
    while text_w > 490 and font_size > 18:
        font_size -= 2
        try:
            font = ImageFont.truetype(font_path, font_size)
            try:
                bbox = draw.textbbox((0, 0), text, font=font)
                text_w = bbox[2] - bbox[0]
                text_h = bbox[3] - bbox[1]
            except AttributeError:
                text_w, text_h = draw.textsize(text, font=font)
        except Exception:
            break
            
    # Center position with slight random offsets
    x = max(10, (512 - text_w) // 2 + random.randint(-15, 15))
    y = max(10, (128 - text_h) // 2 + random.randint(-5, 5))
    
    # Render text in dark grey or black
    text_color = random.randint(0, 50)
    draw.text((x, y), text, font=font, fill=text_color)
    
    # Rotate the image slightly to simulate handwritten slant
    angle = random.uniform(-4.0, 4.0)
    # Rotate and fill background with light grey/white
    img = img.rotate(angle, resample=Image.BILINEAR, expand=False, fillcolor=bg_color)
    
    # Add noise & blurring
    img = add_noise_and_deform(img)
    
    img.save(output_path)

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fonts_dir = os.path.join(base_dir, 'data', 'raw', 'fonts')
    processed_dir = os.path.join(base_dir, 'data', 'processed')
    synthetic_out_dir = os.path.join(processed_dir, 'synthetic_set')
    os.makedirs(synthetic_out_dir, exist_ok=True)
    
    # 1. Download fonts
    font_paths = download_fonts(fonts_dir)
    if not font_paths:
        print("CRITICAL ERROR: No handwriting fonts could be downloaded.")
        return
        
    # 2. Load drug names and generate target labels
    medicines = load_words(processed_dir)
    print(f"Loaded {len(medicines)} medicines/brands for synthetic generation.")
    
    labels = generate_prescription_strings(medicines)
    print(f"Generated {len(labels)} synthetic prescription label strings.")
    
    # 3. Render and save images
    labels_csv_path = os.path.join(processed_dir, "synthetic_labels.csv")
    print("Generating synthetic images and writing labels.csv...")
    
    # Disable PIL decompression bomb warning since we create multiple images
    Image.MAX_IMAGE_PIXELS = None
    
    with open(labels_csv_path, mode='w', newline='', encoding='utf-8') as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["Images", "Text"])
        
        for idx, text in enumerate(labels):
            img_filename = f"S_{idx:05d}.jpg"
            img_path = os.path.join(synthetic_out_dir, img_filename)
            
            # Draw and save
            render_text_image(text, font_paths, img_path)
            
            # Write row (store relative path for convenience)
            writer.writerow([os.path.join("synthetic_set", img_filename), text])
            
            if (idx + 1) % 1000 == 0:
                print(f"Rendered {idx + 1}/9000 images...")
                
    print(f"[OK] Synthetic generation complete! Images saved to {synthetic_out_dir}, labels saved to {labels_csv_path}.")

if __name__ == "__main__":
    main()
