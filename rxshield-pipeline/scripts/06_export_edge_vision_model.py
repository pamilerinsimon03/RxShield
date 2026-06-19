import os
import sys
import shutil
import ssl

# Reconfigure stdout/stderr to utf-8 to avoid charmap encoding errors on Windows terminal
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
import torch
import torch.nn as nn
from datasets import load_dataset
from onnxruntime.quantization import quantize_dynamic, QuantType

# Define CharacterMapper dummy class so torch.load unpickles it correctly
class CharacterMapper:
    def __init__(self):
        pass
    def __setstate__(self, state):
        self.__dict__.update(state)

class CRNN(nn.Module):
    """CNN-BiLSTM-CTC for Handwriting Recognition"""
    def __init__(self, img_height=128, num_chars=74, hidden_size=256, num_layers=2):
        super(CRNN, self).__init__()

        # CNN Feature Extractor
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2, 2),
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(), nn.MaxPool2d(2, 2),
            nn.Conv2d(128, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(),
            nn.Conv2d(256, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(), nn.MaxPool2d((2, 1)),
            nn.Conv2d(256, 512, 3, padding=1), nn.BatchNorm2d(512), nn.ReLU(),
            nn.Conv2d(512, 512, 3, padding=1), nn.BatchNorm2d(512), nn.ReLU(), nn.MaxPool2d((2, 1)),
            nn.Conv2d(512, 512, 2), nn.BatchNorm2d(512), nn.ReLU(),
        )

        self.map2seq = nn.Linear(512 * 7, hidden_size)
        self.rnn = nn.LSTM(hidden_size, hidden_size, num_layers, bidirectional=True,
                           dropout=0.3 if num_layers > 1 else 0, batch_first=True)
        self.fc = nn.Linear(hidden_size * 2, num_chars + 1)

    def forward(self, x):
        conv = self.cnn(x)
        b, c, h, w = conv.size()
        conv = conv.permute(0, 3, 1, 2).reshape(b, w, c * h)
        seq = self.map2seq(conv)
        rnn_out, _ = self.rnn(seq)
        output = self.fc(rnn_out)
        return torch.nn.functional.log_softmax(output, dim=2)

def main():
    # Bypass SSL verification for HF dataset downloading just in case
    ssl._create_default_https_context = ssl._create_unverified_context
    
    # 1. Dataset Verification Stream
    print("Testing connectivity to Hugging Face by streaming 'Teklia/IAM-line'...")
    try:
        dataset = load_dataset("Teklia/IAM-line", split="train", streaming=True)
        it = iter(dataset)
        sample = next(it)
        if hasattr(it, "close"):
            try:
                it.close()
            except Exception:
                pass
        print(f"[OK] Dataset stream verified successfully! Keys: {list(sample.keys())}")
    except Exception as e:
        print(f"Dataset stream connection test failed: {e}")
        # Note: If streaming fails due to proxy constraints, we can still proceed with local model compilation.
        # However, we print it out clearly.
        
    # 2. Load PyTorch model weights (with automatic fallback download)
    checkpoint_path = "best_model.pth"
    if not os.path.exists(checkpoint_path):
        print(f"Weight file {checkpoint_path} not found. Automatically downloading from Hugging Face...")
        try:
            from huggingface_hub import hf_hub_download
            hf_hub_download(
                repo_id="ismatsamadov/handwriting-recognition-iam",
                filename="best_model.pth",
                local_dir="."
            )
            print("[OK] Automatic download complete.")
        except Exception as e:
            print(f"CRITICAL ERROR: Failed to download weights automatically: {e}")
            sys.exit(1)
        
    print(f"Loading PyTorch checkpoint from {checkpoint_path}...")
    try:
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        print("[OK] PyTorch checkpoint loaded successfully.")
    except Exception as e:
        print(f"CRITICAL ERROR: Failed to load PyTorch checkpoint: {e}")
        sys.exit(1)
        
    state_dict = checkpoint.get("model_state_dict")
    char_mapper = checkpoint.get("char_mapper")
    num_chars = len(char_mapper.chars) if char_mapper else 74
    print(f"Loaded epoch {checkpoint.get('epoch')}, val CER: {checkpoint.get('val_cer')}, classes count: {num_chars + 1}")
    
    # Reconstruct network and load weights
    model = CRNN(img_height=128, num_chars=num_chars, hidden_size=256, num_layers=2)
    model.load_state_dict(state_dict)
    model.eval()
    print("[OK] Model structure instantiated and state dictionary successfully loaded.")
    
    # 3. Export to ONNX format
    onnx_path = "crnn.onnx"
    print(f"Exporting model to {onnx_path}...")
    # Grayscale camera crop image shape: 1 x 1 x 128 x 512
    dummy_input = torch.randn(1, 1, 128, 512)
    try:
        torch.onnx.export(
            model,
            dummy_input,
            onnx_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            dynamo=False,
            input_names=["input_images"],
            output_names=["output_logits"],
            dynamic_axes={
                "input_images": {0: "batch_size", 3: "width"},
                "output_logits": {0: "batch_size", 1: "time_step"}
            }
        )
        print("[OK] ONNX export complete.")
    except Exception as e:
        print(f"CRITICAL ERROR: ONNX export failed: {e}")
        sys.exit(1)
        
    # 4. Dynamic Quantization (INT8)
    quantized_path = "crnn_int8.onnx"
    print(f"Applying post-training dynamic INT8 quantization to {quantized_path}...")
    try:
        quantize_dynamic(
            model_input=onnx_path,
            model_output=quantized_path,
            weight_type=QuantType.QUInt8
        )
        print("[OK] Dynamic quantization pass completed.")
    except Exception as e:
        print(f"CRITICAL ERROR: Quantization matrix pass failed: {e}")
        sys.exit(1)
        
    # 5. Volume Audit and Size Limit Verification (Cap at 15,000,000 bytes)
    size_bytes = os.path.getsize(quantized_path)
    size_mb = size_bytes / (1024 * 1024)
    limit_bytes = 15000000
    print(f"Final Quantized ONNX size: {size_mb:.4f} MB ({size_bytes} bytes)")
    
    if size_bytes > limit_bytes:
        print(f"CRITICAL ERROR: Quantized model size exceeds 15MB payload cap ({limit_bytes} bytes). Aborting.")
        sys.exit(1)
    print("[OK] Model size lies safely within the 15MB ceiling constraint.")
    
    # 6. Copy across workspace boundary
    dest_dir = "../rxshield-web/public/models"
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, "crnn_int8.onnx")
    print(f"Transferring model across boundary to {dest_path}...")
    try:
        shutil.copy2(quantized_path, dest_path)
        print("[OK] Optimized vision model deployed to the web application successfully!")
    except Exception as e:
        print(f"CRITICAL ERROR: Boundary copy failed: {e}")
        sys.exit(1)
        
    print("Export pipeline complete!")

if __name__ == "__main__":
    main()
