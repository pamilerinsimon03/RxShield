const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const destDir = path.join(__dirname, '..', 'public', 'wasm');

// Ensure destination directory exists and clean it
if (fs.existsSync(destDir)) {
  const existingFiles = fs.readdirSync(destDir);
  existingFiles.forEach(file => {
    try {
      fs.unlinkSync(path.join(destDir, file));
    } catch (err) {
      console.warn(`Could not delete existing file ${file}:`, err);
    }
  });
} else {
  fs.mkdirSync(destDir, { recursive: true });
}

if (!fs.existsSync(srcDir)) {
  console.error(`Source directory does not exist: ${srcDir}`);
  process.exit(1);
}

const files = fs.readdirSync(srcDir);
let copiedCount = 0;

files.forEach(file => {
  if (file.startsWith('ort-wasm-simd-threaded')) {
    if (file.endsWith('.wasm') || file.endsWith('.mjs')) {
      // Exclude JSEP (WebGPU/WebGL) and Asyncify (slow fallback) to stay under 45MB bundle size
      if (file.includes('jsep') || file.includes('asyncify')) {
        console.log(`Skipped (optimized out): ${file}`);
        return;
      }

      const srcPath = path.join(srcDir, file);
      const destPath = path.join(destDir, file);
      
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied: ${file} -> public/wasm/`);
      copiedCount++;
    }
  }
});

console.log(`Successfully copied ${copiedCount} WASM assets to public/wasm/`);
