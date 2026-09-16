// One-off content editor: merges new prose into a data file without touching
// the fields it does not mention.
//   node scripts/edit-content.mjs <file> <patch.json> [--escape-non-ascii]
//
// --escape-non-ascii writes every character above U+007F as a \uXXXX escape,
// which is how design.json and design-answers.json are already stored.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const escapeNonAscii = args.includes('--escape-non-ascii');
const [file, patchFile] = args.filter((a) => !a.startsWith('--'));
if (!file || !patchFile) {
  console.error(
    'usage: node scripts/edit-content.mjs <data-file> <patch.json>',
  );
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
const patch = JSON.parse(readFileSync(patchFile, 'utf8'));
// Fields a patch may introduce, and a null value removes a field entirely.
const ADDABLE = new Set(['note', 'rubric', 'references', 'difficulty']);
let touched = 0;

const apply = (target, updates) => {
  for (const [key, fields] of Object.entries(updates)) {
    if (!target[key]) throw new Error(`No such key: ${key}`);
    for (const [field, value] of Object.entries(fields)) {
      if (value === null) {
        delete target[key][field];
        continue;
      }
      if (!(field in target[key]) && !ADDABLE.has(field))
        throw new Error(`${key} has no field "${field}"`);
      target[key][field] = value;
    }
    touched++;
  }
};

if (Array.isArray(data)) {
  const byId = Object.fromEntries(data.map((entry) => [entry.id, entry]));
  apply(byId, patch);
} else {
  apply(data, patch);
}

const serialised = JSON.stringify(data, null, 2) + '\n';
writeFileSync(
  file,
  escapeNonAscii
    ? serialised.replace(
        // oxlint-disable-next-line eslint/no-control-regex -- Preserve the design files' escaped non-ASCII format.
        /[^\u0000-\u007F]/g,
        (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
      )
    : serialised,
);
console.log(`Updated ${touched} entries in ${file}`);
