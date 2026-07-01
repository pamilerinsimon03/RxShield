import os
import csv
import random
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, Sampler
from PIL import Image, ImageEnhance
import numpy as np
import sys

# Reconfigure stdout/stderr to avoid character encoding errors on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Define CharacterMapper class so torch.load unpickles it correctly
class CharacterMapper:
    def __init__(self):
        pass
    def __setstate__(self, state):
        self.__dict__.update(state)

class CRNN(nn.Module):
    """CNN-BiLSTM-CTC for Handwriting Recognition"""
    def __init__(self, img_height=128, num_chars=74, hidden_size=256, num_layers=2):
        super(CRNN, self).__init__()

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

class RxDataset(Dataset):
    """
    Dataset class for prescription images.
    Loads and cleans target texts, applies reproducible subsetting if requested,
    and pre-caches resized images in RAM to eliminate I/O bottlenecks.
    Optionally applies data augmentation (rotation, brightness, contrast).
    """
    def __init__(self, labels_file, img_dir, char_mapper, augment=False, subset_size=None):
        self.img_dir = img_dir
        self.char_mapper = char_mapper
        self.augment = augment
        
        self.samples = []
        with open(labels_file, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                img_name = row.get("Images") or row.get("Image")
                text = row.get("Text")
                if img_name and text is not None:
                    cleaned_text = "".join([c for c in text if c in self.char_mapper.char2idx])
                    if len(cleaned_text) > 0:
                        self.samples.append((img_name, cleaned_text))
        
        if subset_size is not None and subset_size < len(self.samples):
            random.seed(42)
            self.samples = random.sample(self.samples, subset_size)
            
        filename = os.path.basename(labels_file)
        print(f"Pre-loading and resizing {len(self.samples)} images for {filename} into RAM...")
        self.cached_images = []
        for idx, (img_name, _) in enumerate(self.samples):
            img_path = os.path.join(self.img_dir, img_name)
            try:
                img = Image.open(img_path).convert('L')
                img = img.resize((512, 128))
                self.cached_images.append(np.array(img, dtype=np.uint8))
            except Exception:
                self.cached_images.append(np.ones((128, 512), dtype=np.uint8) * 255)
            
            if (idx + 1) % 2000 == 0:
                print(f"  Loaded {idx + 1}/{len(self.samples)} images...")
        print("[OK] Pre-loading complete.")
        
    def __len__(self):
        return len(self.samples)
        
    def __getitem__(self, idx):
        _, text = self.samples[idx]
        img_np_uint8 = self.cached_images[idx]
        
        if self.augment:
            img = Image.fromarray(img_np_uint8)
            angle = random.uniform(-3, 3)
            img = img.rotate(angle, resample=Image.BILINEAR, fillcolor=255)
            
            enh_b = ImageEnhance.Brightness(img)
            img = enh_b.enhance(random.uniform(0.8, 1.2))
            
            enh_c = ImageEnhance.Contrast(img)
            img = enh_c.enhance(random.uniform(0.8, 1.2))
            
            img_np = np.array(img, dtype=np.float32) / 255.0
        else:
            img_np = img_np_uint8.astype(np.float32) / 255.0
            
        img_np = (img_np - 0.5) / 0.5
        
        img_tensor = torch.from_numpy(img_np).unsqueeze(0)
        
        targets = [self.char_mapper.char2idx[char] for char in text]
        targets_tensor = torch.tensor(targets, dtype=torch.long)
        targets_len = torch.tensor(len(targets), dtype=torch.long)
        
        return img_tensor, targets_tensor, targets_len

class BalancedBatchSampler(Sampler):
    def __init__(self, real_indices, synth_indices, batch_size, num_batches=140):
        self.real_indices = list(real_indices)
        self.synth_indices = list(synth_indices)
        self.batch_size = batch_size
        self.half_batch = batch_size // 2
        self.num_batches = num_batches

    def __iter__(self):
        random.shuffle(self.real_indices)
        random.shuffle(self.synth_indices)
        
        real_ptr = 0
        synth_ptr = 0
        for i in range(self.num_batches):
            batch = []
            for _ in range(self.half_batch):
                batch.append(self.real_indices[real_ptr])
                real_ptr = (real_ptr + 1) % len(self.real_indices)
            
            for _ in range(self.half_batch):
                batch.append(self.synth_indices[synth_ptr])
                synth_ptr = (synth_ptr + 1) % len(self.synth_indices)
                
            yield batch

    def __len__(self):
        return self.num_batches

def collate_fn(batch):
    images, targets, target_lengths = zip(*batch)
    images = torch.stack(images, dim=0)
    targets_padded = torch.nn.utils.rnn.pad_sequence(targets, batch_first=True, padding_value=0)
    target_lengths = torch.stack(target_lengths, dim=0)
    return images, targets_padded, target_lengths

def levenshtein_dist(s1, s2):
    if len(s1) < len(s2):
        return levenshtein_dist(s2, s1)
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

def evaluate(model, dataloader, char_mapper, device):
    """
    Evaluates the model on the given validation/test dataloader.
    Computes average loss and average Character Error Rate (CER) using greedy decoding.
    """
    model.eval()
    total_loss = 0
    total_cer = 0
    total_chars = 0
    criterion = nn.CTCLoss(zero_infinity=True)
    
    with torch.no_grad():
        for images, targets, target_lengths in dataloader:
            images = images.to(device)
            targets = targets.to(device)
            
            logits = model(images)
            input_lengths = torch.full(size=(images.size(0),), fill_value=logits.size(1), dtype=torch.long).to(device)
            loss = criterion(logits.permute(1, 0, 2), targets, input_lengths, target_lengths)
                
            total_loss += loss.item() * images.size(0)
            
            logits_np = logits.cpu().numpy()
            for i in range(images.size(0)):
                pred_indices = []
                last_idx = -1
                for t in range(logits_np.shape[1]):
                    max_idx = np.argmax(logits_np[i, t])
                    if max_idx != 0 and max_idx != last_idx:
                        pred_indices.append(max_idx)
                    last_idx = max_idx
                    
                pred_text = "".join([char_mapper.idx2char.get(idx, "") for idx in pred_indices])
                target_indices = targets[i][:target_lengths[i].item()].cpu().numpy()
                target_text = "".join([char_mapper.idx2char.get(idx, "") for idx in target_indices])
                
                total_cer += levenshtein_dist(pred_text, target_text)
                total_chars += len(target_text)
                
    avg_loss = total_loss / len(dataloader.dataset)
    avg_cer = (total_cer / total_chars) if total_chars > 0 else 0.0
    return avg_loss, avg_cer

def main():
    """
    Main training workflow:
    1. Loads the baseline model checkpoint and expands the character mapper vocabulary to support '/' and '+'.
    2. Sets up real (RxHandBD) and synthetic dataset loaders with RAM pre-loading.
    3. Builds the CRNN model architecture, performs weight surgery to transfer baseline weights,
       expands the fully-connected classification head, and freezes the convolutional and recurrent feature extractors.
    4. Trains the model classification head on balanced batches using CTCLoss, evaluates
       using Character Error Rate (CER), and saves the best checkpoint.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    processed_dir = os.path.join(base_dir, 'data', 'processed')
    raw_dir = os.path.join(base_dir, 'data', 'raw')
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training will run on device: {device}")
    
    checkpoint_path = os.path.join(base_dir, "best_model.pth")
    if not os.path.exists(checkpoint_path):
        print(f"CRITICAL ERROR: Baseline weights not found at {checkpoint_path}")
        sys.exit(1)
        
    print(f"Loading baseline checkpoint: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    char_mapper = checkpoint.get("char_mapper")
    
    print(f"Baseline characters count: {len(char_mapper.chars)}")
    
    original_chars = list(char_mapper.chars)
    new_symbols = ["/", "+"]
    for sym in new_symbols:
        if sym not in original_chars:
            original_chars.append(sym)
            
    char_mapper.chars = original_chars
    char_mapper.char2idx = {char: idx + 1 for idx, char in enumerate(original_chars)}
    char_mapper.idx2char = {idx + 1: char for idx, char in enumerate(original_chars)}
    char_mapper.char2idx[''] = 0
    char_mapper.idx2char[0] = ''
    
    print(f"Expanded characters count: {len(char_mapper.chars)} (added: {new_symbols})")
    
    rxhandbd_dir = os.path.join(raw_dir, "RxHandBD-ML")
    real_train_labels = os.path.join(rxhandbd_dir, "Train_Label.csv")
    real_train_images = os.path.join(rxhandbd_dir, "Train_Set")
    real_test_labels = os.path.join(rxhandbd_dir, "Test_Label.csv")
    real_test_images = os.path.join(rxhandbd_dir, "Test_Set")
    
    synth_labels = os.path.join(processed_dir, "synthetic_labels.csv")
    synth_images = processed_dir
    
    if not os.path.exists(real_train_labels) or not os.path.exists(synth_labels):
        print("CRITICAL ERROR: Real training labels or synthetic labels not found.")
        sys.exit(1)
        
    print("Loading real and synthetic datasets...")
    real_train_dataset = RxDataset(real_train_labels, real_train_images, char_mapper, augment=True)
    synth_train_dataset = RxDataset(synth_labels, synth_images, char_mapper, augment=False)
    test_dataset = RxDataset(real_test_labels, real_test_images, char_mapper, augment=False)
    
    class UnifiedDataset(Dataset):
        def __init__(self, real_ds, synth_ds):
            self.real_ds = real_ds
            self.synth_ds = synth_ds
            self.real_len = len(real_ds)
            self.synth_len = len(synth_ds)
            
        def __len__(self):
            return self.real_len + self.synth_len
            
        def __getitem__(self, idx):
            if idx < self.real_len:
                return self.real_ds[idx]
            else:
                return self.synth_ds[idx - self.real_len]
                
    unified_train_dataset = UnifiedDataset(real_train_dataset, synth_train_dataset)
    
    real_indices = list(range(len(real_train_dataset)))
    synth_indices = list(range(len(real_train_dataset), len(unified_train_dataset)))
    
    batch_size = 32
    balanced_sampler = BalancedBatchSampler(real_indices, synth_indices, batch_size, num_batches=140)
    
    train_loader = DataLoader(
        unified_train_dataset, 
        batch_sampler=balanced_sampler, 
        collate_fn=collate_fn,
        num_workers=0
    )
    
    test_loader = DataLoader(
        test_dataset,
        batch_size=batch_size,
        shuffle=False,
        collate_fn=collate_fn,
        num_workers=0
    )
    
    print("Constructing CRNN model architecture...")
    num_classes = len(char_mapper.chars)
    model = CRNN(img_height=128, num_chars=num_classes, hidden_size=256, num_layers=2)
    
    original_state_dict = checkpoint.get("model_state_dict")
    
    orig_fc_weight = original_state_dict["fc.weight"]
    orig_fc_bias = original_state_dict["fc.bias"]
    
    new_fc_weight = torch.zeros(num_classes + 1, 512)
    new_fc_bias = torch.zeros(num_classes + 1)
    
    new_fc_weight[:75, :] = orig_fc_weight
    new_fc_bias[:75] = orig_fc_bias
    
    nn.init.normal_(new_fc_weight[75:, :], mean=0.0, std=0.01)
    new_fc_bias[75:] = 0.0
    
    filtered_state_dict = {k: v for k, v in original_state_dict.items() if not k.startswith("fc.")}
    model.load_state_dict(filtered_state_dict, strict=False)
    
    model.fc.weight.data.copy_(new_fc_weight)
    model.fc.bias.data.copy_(new_fc_bias)
    print("Transferred baseline weights and performed partial FC head expansion successfully.")
    
    for param in model.cnn.parameters():
        param.requires_grad = False
    for param in model.map2seq.parameters():
        param.requires_grad = False
    for param in model.rnn.parameters():
        param.requires_grad = False
        
    print("CNN, Map2Seq, and BiLSTM layers FROZEN. Only the classification head (FC) will be trained.")
    
    model.to(device)
    
    criterion = nn.CTCLoss(zero_infinity=True)
    optimizer = optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=1e-3)
    
    epochs = 3
    print(f"Beginning training for {epochs} epochs on CPU/device...")
    
    best_cer = 999.0
    for epoch in range(1, epochs + 1):
        model.train()
        epoch_loss = 0.0
        batches_processed = 0
        
        for batch_idx, (images, targets, target_lengths) in enumerate(train_loader):
            images = images.to(device)
            targets = targets.to(device)
            
            optimizer.zero_grad()
            
            logits = model(images)
            input_lengths = torch.full(size=(images.size(0),), fill_value=logits.size(1), dtype=torch.long).to(device)
            loss = criterion(logits.permute(1, 0, 2), targets, input_lengths, target_lengths)
            
            loss.backward()
            
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=10.0)
            
            optimizer.step()
            
            epoch_loss += loss.item()
            batches_processed += 1
            
            if (batch_idx + 1) % 10 == 0:
                print(f"Epoch {epoch}/{epochs} | Batch {batch_idx + 1}/{len(balanced_sampler)} | Batch Loss: {loss.item():.4f}")
                
        avg_train_loss = epoch_loss / batches_processed if batches_processed > 0 else 0.0
        
        val_loss, val_cer = evaluate(model, test_loader, char_mapper, device)
        print(f"--> Epoch {epoch} Complete | Avg Train Loss: {avg_train_loss:.4f} | Val Loss: {val_loss:.4f} | Val CER: {val_cer * 100:.2f}%")
        
        print("\n--- Visual Validation Examples ---")
        model.eval()
        with torch.no_grad():
            indices = random.sample(range(len(test_dataset)), min(3, len(test_dataset)))
            for idx in indices:
                img_tensor, targets_tensor, _ = test_dataset[idx]
                img_batch = img_tensor.unsqueeze(0).to(device)
                logits = model(img_batch)
                logits_np = logits.cpu().numpy()[0]
                pred_indices = []
                last_idx = -1
                for t in range(logits_np.shape[0]):
                    max_idx = np.argmax(logits_np[t])
                    if max_idx != 0 and max_idx != last_idx:
                        pred_indices.append(max_idx)
                    last_idx = max_idx
                pred_text = "".join([char_mapper.idx2char.get(i, "") for i in pred_indices])
                
                target_indices = targets_tensor.cpu().numpy()
                target_text = "".join([char_mapper.idx2char.get(i, "") for i in target_indices])
                print(f"  Target: {target_text} | Pred: {pred_text}")
        print("----------------------------------\n")
        
        # Save checkpoints safely with atomic rename
        if val_cer < best_cer:
            best_cer = val_cer
            tuned_checkpoint_path = os.path.join(base_dir, "best_model_tuned.pth")
            temp_checkpoint_path = tuned_checkpoint_path + ".tmp"
            
            print(f"New Best Val CER! Saving tuned weights checkpoint to {tuned_checkpoint_path}...")
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'char_mapper': char_mapper,
                'val_cer': val_cer
            }, temp_checkpoint_path)
            
            # Atomic swap
            if os.path.exists(temp_checkpoint_path):
                if os.path.exists(tuned_checkpoint_path):
                    backup_path = tuned_checkpoint_path + ".bak"
                    if os.path.exists(backup_path):
                        os.remove(backup_path)
                    os.rename(tuned_checkpoint_path, backup_path)
                os.rename(temp_checkpoint_path, tuned_checkpoint_path)
                print("[OK] Checkpoint saved successfully.")
            
    print(f"\n[OK] Training completed! Best validation CER achieved: {best_cer * 100:.2f}%")

if __name__ == "__main__":
    main()
