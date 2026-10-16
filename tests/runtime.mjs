import { loadPyodide } from '../public/python/pyodide.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const py = await loadPyodide({
  indexURL: fileURLToPath(new URL('../public/python/', import.meta.url)),
});
py.runPython(
  readFileSync(new URL('../public/runner.py', import.meta.url), 'utf8'),
);
async function run(data) {
  py.globals.set('_submission_json', JSON.stringify(data));
  return JSON.parse(
    await py.runPythonAsync('await run_submission(_submission_json)'),
  );
}
const problems = JSON.parse(
  readFileSync(new URL('../app/data/coding.json', import.meta.url), 'utf8'),
);
const followups = JSON.parse(
  readFileSync(new URL('../app/data/followups.json', import.meta.url), 'utf8'),
);
let total = 0;
for (const p of [...problems, ...followups]) {
  const r = await run({ code: p.solution, tests: p.tests });
  assert.ok(!r.error, JSON.stringify(r));
  for (const t of r.results)
    assert.ok(t.passed, `${p.id}: ${t.name}\n${t.error}`);
  total += r.results.length;
}
for (const base of problems) {
  const extension = followups.find((p) => p.id === base.id);
  assert.ok(extension, `Missing follow-up lab: ${base.id}`);
  assert.deepEqual(
    extension.answers.map((a) => a.question),
    base.followups,
    `Unanswered follow-up: ${base.id}`,
  );
  const starterResult = await run({
    code: extension.starter,
    tests: extension.tests,
  });
  assert.ok(
    starterResult.results.some((t) => !t.passed),
    `Follow-up tests accepted empty starter: ${base.id}`,
  );
}
const designs = JSON.parse(
  readFileSync(new URL('../app/data/design.json', import.meta.url), 'utf8'),
);
const answers = JSON.parse(
  readFileSync(
    new URL('../app/data/design-answers.json', import.meta.url),
    'utf8',
  ),
);
const SECTION_IDS = ['scope', 'estimates', 'data', 'flow', 'failure', 'ops'];
for (const d of designs) {
  const a = answers.find((a) => a.id === d.id);
  // Probes and failures moved from bare strings to tagged objects, so compare
  // the questions and scenarios rather than the whole entries.
  assert.deepEqual(
    a?.probes.map((p) => p.question),
    d.probes.map((p) => p.question),
  );
  assert.deepEqual(
    a?.failures.map((f) => f.scenario),
    d.failures.map((f) => f.scenario),
  );
  // Exactly one rubric per interview section, in the order the interview runs.
  assert.deepEqual(
    d.rubric?.map((r) => r.section),
    SECTION_IDS,
    `Rubric sections out of order or missing: ${d.id}`,
  );
  for (const entry of d.rubric) {
    assert.ok(
      Array.isArray(entry.expects) && entry.expects.length === 3,
      `Rubric needs 3 expectations: ${d.id}/${entry.section}`,
    );
    for (const text of entry.expects) {
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 30, `Rubric item too thin: ${d.id}`);
    }
  }
  // Every probe and failure has to be injected at a section that exists.
  for (const p of d.probes)
    assert.ok(
      SECTION_IDS.includes(p.section),
      `Probe tagged with unknown section: ${d.id}`,
    );
  for (const f of d.failures)
    assert.ok(
      SECTION_IDS.includes(f.section),
      `Failure tagged with unknown section: ${d.id}`,
    );
  // Every section needs a reference answer, or the Solution tab is a dead end.
  assert.deepEqual(
    Object.keys(a?.references ?? {}).sort(),
    [...SECTION_IDS].sort(),
    `References must cover every section: ${d.id}`,
  );
  for (const [section, text] of Object.entries(a.references))
    assert.ok(
      text.trim().length > 120,
      `Reference answer too thin: ${d.id}/${section}`,
    );
  assert.equal('focus' in d, false, `focus was replaced by rubric: ${d.id}`);
}
const bad = await run({ code: 'def broken(:\n pass', tests: [] });
assert.match(bad.error, /SyntaxError/);
const fail = await run({
  code: 'x=1',
  tests: [{ name: 'intentional failure', code: 'assert x == 2' }],
});
assert.equal(fail.results[0].passed, false);
const io = await run({
  code: 'print(input()); print(0)',
  stdin: 'hello\n',
  tests: [],
});
assert.equal(io.output, 'hello\n0\n');
const fresh = await run({ code: 'print("x" in globals())', tests: [] });
assert.equal(fresh.output, 'False\n');
const long = await run({ code: 'print("a" * 50000)', tests: [] });
assert.ok(long.output.length < 20100);
assert.match(long.output, /truncated/);

for (const p of problems) {
  const r = await run({ code: p.starter, tests: p.tests });
  assert.ok(
    r.results.some((t) => !t.passed),
    `Base tests accepted unfinished starter: ${p.id}`,
  );
}
const stderr = await run({
  code: 'import sys; print("diagnostic", file=sys.stderr)',
  tests: [],
});
assert.equal(stderr.output, 'diagnostic\n');
const awaitResult = await run({
  code: 'import asyncio\nawait asyncio.sleep(0)\nprint("awaited")',
  tests: [],
});
assert.equal(awaitResult.output, 'awaited\n');
const isolation = await run({
  code: 'items=[]',
  tests: [
    { name: 'first', code: 'items.append(1)' },
    { name: 'second', code: 'assert items==[]' },
  ],
});
assert.ok(isolation.results.every((t) => t.passed));
const continues = await run({
  code: 'x=1',
  tests: [
    { name: 'failure', code: 'raise ValueError("first")' },
    { name: 'later', code: 'assert x==1' },
  ],
});
assert.equal(continues.results[0].passed, false);
assert.equal(continues.results[1].passed, true);
const exit = await run({ code: 'raise SystemExit(2)', tests: [] });
assert.match(exit.error, /SystemExit/);
const noInput = await run({ code: 'input()', tests: [] });
assert.match(noInput.error, /EOFError/);
// A failed assertion must explain itself: the statement, and both sides as
// they were actually compared.
const explained = await run({
  code: 'hits=[]\ndef hit():\n    hits.append(1)\n    return len(hits)\n',
  tests: [
    { name: 'value mismatch', code: 'x=1\nassert x==2' },
    {
      name: 'stateful call',
      code: 'assert [hit() for _ in range(3)]==[1,1,1]',
    },
    { name: 'author message', code: 'x=1\nassert x==2, "x must be two"' },
    { name: 'crash', code: 'assert {}["missing"]=="x"' },
  ],
});
const [mismatch, stateful, messaged, crashed] = explained.results;
assert.match(mismatch.error, /Failed: x == 2/);
assert.match(mismatch.error, /left  = 1/);
assert.match(mismatch.error, /right = 2/);
// Operands are captured once, so a stateful call reports the first result
// rather than a second evaluation of the same expression.
assert.match(stateful.error, /left  = \[1, 2, 3\]/);
assert.match(stateful.error, /right = \[1, 1, 1\]/);
assert.match(messaged.error, /AssertionError: x must be two$/m);
// A crash is not an assertion failure and must stay undecorated, with the
// exception last so callers can still tell the two apart.
assert.doesNotMatch(crashed.error, /Failed: /);
assert.match(crashed.error, /KeyError: 'missing'$/m);
// The exception line stays last on every assertion failure.
for (const t of [mismatch, stateful, messaged])
  assert.match(t.error, /AssertionError.*$/m);

const formatted = JSON.parse(
  readFileSync(
    new URL('../app/data/problem-content.json', import.meta.url),
    'utf8',
  ),
);
let examples = 0;
for (const [key, entry] of Object.entries(formatted)) {
  const [id, stage] = key.split(':');
  const p = (stage ? followups : problems).find((p) => p.id === id);
  for (const example of entry.examples) {
    const r = await run({ code: p.solution + '\n' + example.code, tests: [] });
    assert.ok(!r.error, `${key}: ${r.error}`);
    assert.equal(
      r.output.trimEnd(),
      example.output,
      `Example mismatch: ${key}`,
    );
    examples++;
  }
}
console.log(
  `PASS: ${examples} formatted examples match the bundled Python runtime.`,
);
console.log(
  `PASS: ${problems.length + followups.length} solutions / ${total} groups in bundled WebAssembly Python; syntax errors, assertion failures, stdin/stdout, isolation, output limits.`,
);
