// Run after npm run build. These utilities disappeared when component source
// discovery failed, leaving tabs stacked and checkbox/button styling absent.
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const files = readdirSync('dist/client', { recursive: true }).filter((p) =>
  p.endsWith('.css'),
);
assert.ok(files.length, 'Build CSS must exist');
const css = files
  .map((p) => readFileSync(`dist/client/${p}`, 'utf8'))
  .join('\n');
for (const selector of [
  '.inline-flex',
  '.items-center',
  '.justify-center',
  '.shrink-0',
  '.size-4',
  '.bg-primary',
]) {
  assert.ok(
    css.includes(selector),
    `Missing shared-control utility: ${selector}`,
  );
}
assert.ok(
  !/aside\s+button\s*\{/.test(css),
  'Problem-row layout must not affect every sidebar button',
);
console.log(
  'PASS: built CSS includes shared-control layout, size, and color utilities; sidebar button styles are scoped.',
);
