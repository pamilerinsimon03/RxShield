const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.resolve(__dirname, '../out');
const SIZE_LIMIT_MB = 45;
const SIZE_LIMIT_BYTES = SIZE_LIMIT_MB * 1024 * 1024;

function getDirectorySize(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  
  const files = fs.readdirSync(dirPath);

  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(dirPath, files[i]);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      size += getDirectorySize(filePath);
    } else {
      size += stats.size;
    }
  }

  return size;
}

if (!fs.existsSync(BUILD_DIR)) {
  console.error(`Error: Build directory ${BUILD_DIR} does not exist. Run next build first.`);
  process.exit(1);
}

const totalSize = getDirectorySize(BUILD_DIR);
const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);

console.log(`\n========================================`);
console.log(`BUNDLE SIZE AUDIT`);
console.log(`========================================`);
console.log(`Build Directory: ${BUILD_DIR}`);
console.log(`Total Size:      ${totalSizeMB} MB (${totalSize.toLocaleString()} bytes)`);
console.log(`Hard Limit:      ${SIZE_LIMIT_MB} MB (${SIZE_LIMIT_BYTES.toLocaleString()} bytes)`);

if (totalSize > SIZE_LIMIT_BYTES) {
  console.error(`\n❌ ERROR: Build footprint exceeds the strict 45MB limit!`);
  process.exit(1);
} else {
  console.log(`\n✅ SUCCESS: Bundle size is within safe bounds!`);
  process.exit(0);
}
