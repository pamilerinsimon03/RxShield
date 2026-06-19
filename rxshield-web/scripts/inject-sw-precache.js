const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '../out');
const swPath = path.resolve(outDir, 'sw.js');

function walkDir(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(filePath));
    } else {
      results.push(filePath);
    }
  });
  return results;
}

if (!fs.existsSync(swPath)) {
  console.error(`Error: Service worker file not found at ${swPath}. Make sure the build succeeded.`);
  process.exit(1);
}

const allFiles = walkDir(outDir);

// Convert absolute paths to relative URLs (site root relative)
const assetsToCache = allFiles
  .map(file => {
    const relativePath = path.relative(outDir, file).replace(/\\/g, '/');
    return '/' + relativePath;
  })
  .filter(url => {
    // Exclude the service worker itself, and any map files
    if (url === '/sw.js') return false;
    if (url.endsWith('.map')) return false;
    return true;
  });

// Make sure we include '/' (root page)
if (!assetsToCache.includes('/')) {
  assetsToCache.unshift('/');
}

console.log(`\n========================================`);
console.log(`SERVICE WORKER PRECACHE INJECTION`);
console.log(`========================================`);
console.log(`Found ${assetsToCache.length} static assets to precache.`);

// Read sw.js from out/
let swContent = fs.readFileSync(swPath, 'utf8');

// Replace PRECACHE_ASSETS array in swContent
const arrayRegex = /const\s+PRECACHE_ASSETS\s*=\s*\[[^]*?\];/;
const replacement = `const PRECACHE_ASSETS = ${JSON.stringify(assetsToCache, null, 2)};`;

if (arrayRegex.test(swContent)) {
  swContent = swContent.replace(arrayRegex, replacement);
  fs.writeFileSync(swPath, swContent, 'utf8');
  console.log(`✅ Successfully injected precache assets into out/sw.js`);
} else {
  console.error(`❌ Error: Could not find PRECACHE_ASSETS placeholder in sw.js`);
  process.exit(1);
}
