import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const indexPath = path.join(rootDir, 'index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');

// Match `const D = {...};`
const match = indexContent.match(/const D\s*=\s*(\{[\s\S]*?\});\r?\n/);
if (!match) {
  throw new Error('Failed to locate `const D = ...;` in index.html');
}

const rawJson = match[1];
const D = JSON.parse(rawJson);

console.log('Parsed D successfully:');
console.log(`- schools: ${D.schools?.length} (expected 115)`);
console.log(`- res: ${D.res?.length} (expected 138)`);
console.log(`- dongs: ${D.dongs?.length} (expected 49)`);
console.log(`- outlines: ${Object.keys(D.outlines || {}).length} (expected 4)`);

// Strict assertions
if (D.schools?.length !== 115) throw new Error(`Assertion failed: D.schools.length !== 115 (${D.schools?.length})`);
if (D.res?.length !== 138) throw new Error(`Assertion failed: D.res.length !== 138 (${D.res?.length})`);
if (D.dongs?.length !== 49) throw new Error(`Assertion failed: D.dongs.length !== 49 (${D.dongs?.length})`);
if (Object.keys(D.outlines || {}).length !== 4) throw new Error(`Assertion failed: Object.keys(D.outlines).length !== 4`);

const dataDir = path.join(rootDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const outPath = path.join(dataDir, 'stis-raw.js');
const fileContent = `export const D = ${JSON.stringify(D)};\n`;
fs.writeFileSync(outPath, fileContent, 'utf8');
console.log(`Successfully wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
