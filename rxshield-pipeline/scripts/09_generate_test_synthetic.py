import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

def add_noise_and_deform(image):
    # Convert image to numpy array
    img_data = np.array(image)
    h, w = img_data.shape
    
    # Add mild noise
    noise_level = random.uniform(0.005, 0.015)
    noise = np.random.randn(h, w) * 255 * noise_level
    img_data = np.clip(img_data + noise, 0, 255).astype(np.uint8)
    
    # Return as Pillow Image
    image = Image.fromarray(img_data)
    
    # Random mild Gaussian Blur
    blur_radius = random.uniform(0.3, 0.8)
    image = image.filter(ImageFilter.GaussianBlur(blur_radius))
    
    return image

def render_text_image(text, font_paths, output_path):
    # Target image size: 128x512
    bg_color = random.randint(240, 255) # Light background
    img = Image.new('L', (512, 128), color=bg_color)
    draw = ImageDraw.Draw(img)
    
    # Select random font and size
    font_path = random.choice(font_paths)
    font_size = random.randint(30, 42)
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception:
        font = ImageFont.load_default()
        
    # Get text size
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
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
    x = max(15, (512 - text_w) // 2 + random.randint(-10, 10))
    y = max(10, (128 - text_h) // 2 + random.randint(-4, 4))
    
    # Render text in dark grey or black
    text_color = random.randint(0, 40)
    draw.text((x, y), text, font=font, fill=text_color)
    
    # Rotate the image slightly to simulate handwritten slant
    angle = random.uniform(-3.5, 3.5)
    img = img.rotate(angle, resample=Image.BILINEAR, expand=False, fillcolor=bg_color)
    
    # Add noise & blurring
    img = add_noise_and_deform(img)
    
    img.save(output_path)

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fonts_dir = os.path.join(base_dir, 'data', 'raw', 'fonts')
    output_dir = os.path.join(base_dir, '..', 'rxshield-web', 'public', 'synthetic-test-images')
    os.makedirs(output_dir, exist_ok=True)
    
    # 1. Gather fonts
    font_files = [f for f in os.listdir(fonts_dir) if f.endswith('.ttf')]
    font_paths = [os.path.join(fonts_dir, f) for f in font_files]
    if not font_paths:
        print("CRITICAL ERROR: No handwriting fonts found in data/raw/fonts/")
        return
        
    # 2. Hardcoded challenging test cases
    test_prescriptions = [
        "Amoxil 500mg TDS",
        "Simvastatin 40mg",
        "Clarithromycin 500mg",
        "Methotrexate 7.5mg Daily",
        "Azathioprine 50mg",
        "Panadol 1g BD",
        "Tylenol 150mg",
        "Augmentin 625mg TDS",
        "Lasix 250mg",
        "Lipitor 10mg",
        "Ciprofloxacin 500mg BD",
        "Metronidazole 400mg TDS",
        "Artemether + Lumefantrine",
        "Co-trimoxazole 480mg BD",
        "Ventolin 2mg TDS",
        "Zinnat 250mg BD",
        "Flagyl 400mg TDS",
        "Simvastatin 40mg + Clarithromycin",
        "Amlodipine 5mg Daily",
        "Omeprazole 20mg OM"
    ]
    
    print(f"Generating {len(test_prescriptions)} custom synthetic test prescription images...")
    
    for idx, text in enumerate(test_prescriptions):
        # We save the image file named exactly like the ground truth text
        # (replacing unsafe filename chars if any, but since these are clean, we just append .jpg)
        filename = f"{text}.jpg"
        # Avoid slashes in filename (e.g. for combined names, though none have it here)
        filename = filename.replace("/", "_")
        
        img_path = os.path.join(output_dir, filename)
        render_text_image(text, font_paths, img_path)
        print(f"[{idx+1}/{len(test_prescriptions)}] Rendered: {filename}")
        
    print(f"[OK] Completed generation. Test images saved to: {output_dir}")

if __name__ == "__main__":
    main()
