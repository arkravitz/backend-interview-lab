// Restyle reference solutions from real .py files, so no hand-escaping.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [file, dir] = process.argv.slice(2);
if (!file || !dir) {
  console.error(
    'usage: node scripts/apply-solutions.mjs <data-file> <dir-of-py>',
  );
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(data) ? data : Object.values(data);
let applied = 0;
const missing = [];

for (const entry of list) {
  if (!entry.solution) continue;
  const path = join(dir, `${entry.id}.py`);
  if (!existsSync(path)) {
    missing.push(entry.id);
    continue;
  }
  let source = readFileSync(path, 'utf8');
  // Solutions are stored with a trailing newline and no leading blank lines.
  source = source.replace(/^\n+/, '').replace(/\s+$/, '\n');
  entry.solution = source;
  applied++;
}

writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(
  `Applied ${applied} solutions${missing.length ? ` (skipped: ${missing.join(', ')})` : ''}`,
);
