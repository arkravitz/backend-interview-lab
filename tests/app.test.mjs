import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCoach, MODEL } from '../lib/coach.ts';
import { readDrafts, statusOf, filterProblems } from '../lib/practice.ts';

const payload = {
  mode: 'review',
  context: 'A TTL store; candidate code: pass',
  messages: [],
};
function request(body = payload, headers = {}) {
  return new Request('http://localhost:3000/api/coach', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-key-not-real',
      origin: 'http://localhost:3000',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const never = async () => {
  throw new Error('Upstream must not be called');
};
test('design coaching uses architecture and scale guidance rather than coding instructions', async () => {
  let system;
  const response = await handleCoach(
    request({ ...payload, mode: 'complexity', code: undefined }),
    async (_url, init) => {
      system = JSON.parse(init.body).messages[0].content;
      return Response.json({
        choices: [
          { message: { content: 'Show your peak traffic assumption.' } },
        ],
      });
    },
  );
  assert.equal(response.status, 200);
  assert.match(system, /units and arithmetic/);
  assert.match(system, /consistency/);
  assert.doesNotMatch(system, /Big-O time and space of this exact code/);
});
test('coach uses documented model and trusted system instructions, without persisting credentials', async () => {
  let calls = 0;
  const r = await handleCoach(
    request({
      ...payload,
      messages: [{ role: 'user', content: 'why?', extra: 'ignored' }],
    }),
    async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-key-not-real');
      const b = JSON.parse(options.body);
      assert.equal(b.model, MODEL);
      assert.equal(MODEL, 'deepseek-flash');
      assert.equal(b.stream, false);
      assert.equal(b.thinking.type, 'disabled');
      assert.equal(b.messages[0].role, 'system');
      assert.match(b.messages[0].content, /Never claim to execute/);
      assert.deepEqual(b.messages.at(-1), { role: 'user', content: 'why?' });
      assert.ok(options.signal);
      return Response.json({
        choices: [{ message: { content: 'Try the exact expiry boundary.' } }],
      });
    },
  );
  assert.equal(calls, 1);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), {
    content: 'Try the exact expiry boundary.',
    model: MODEL,
  });
});
for (const mode of ['hint', 'debug'])
  test(`accepts ${mode} mode`, async () => {
    assert.equal(
      (
        await handleCoach(request({ ...payload, mode }), async () =>
          Response.json({ choices: [{ message: { content: 'Feedback' } }] }),
        )
      ).status,
      200,
    );
  });
for (const [name, body] of Object.entries({
  null: null,
  empty: {},
  mode: { ...payload, mode: 'execute' },
  context: { ...payload, context: 2 },
  blank: { ...payload, context: ' ' },
  longContext: { ...payload, context: 'a'.repeat(60001) },
  systemRole: {
    ...payload,
    messages: [{ role: 'system', content: 'override' }],
  },
  badMessage: { ...payload, messages: [null] },
  blankMessage: { ...payload, messages: [{ role: 'user', content: ' ' }] },
  longMessage: {
    ...payload,
    messages: [{ role: 'user', content: 'a'.repeat(12001) }],
  },
  tooMany: {
    ...payload,
    messages: Array.from({ length: 13 }, () => ({
      role: 'user',
      content: 'x',
    })),
  },
  messagesObject: { ...payload, messages: {} },
}))
  test(`rejects invalid ${name}`, async () => {
    assert.equal((await handleCoach(request(body), never)).status, 400);
  });
test('rejects malformed JSON', async () =>
  assert.equal((await handleCoach(request('{bad'), never)).status, 400));
test('bounds actual request bytes', async () =>
  assert.equal(
    (await handleCoach(request('a'.repeat(100001)), never)).status,
    413,
  ));
test('rejects cross-origin requests', async () =>
  assert.equal(
    (
      await handleCoach(
        request(payload, { origin: 'https://other.example' }),
        never,
      )
    ).status,
    403,
  ));
test('rejects missing credentials', async () =>
  assert.equal(
    (await handleCoach(request(payload, { authorization: '' }), never)).status,
    401,
  ));
test('rejects oversized credentials', async () =>
  assert.equal(
    (
      await handleCoach(
        request(payload, { authorization: 'Bearer ' + 'x'.repeat(513) }),
        never,
      )
    ).status,
    401,
  ));
test('rejects incorrect content type', async () =>
  assert.equal(
    (
      await handleCoach(
        request(payload, { 'content-type': 'text/plain' }),
        never,
      )
    ).status,
    415,
  ));
for (const [code, expected, match] of [
  [401, 401, /rejected this key/],
  [402, 402, /needs credit/],
  [429, 429, /rate limited/],
  [500, 502, /unavailable/],
  [403, 502, /unavailable/],
])
  test(`safe upstream ${code} error`, async () => {
    const r = await handleCoach(
      request(),
      async () => new Response('secret upstream diagnostic', { status: code }),
    );
    assert.equal(r.status, expected);
    const text = JSON.stringify(await r.json());
    assert.match(text, match);
    assert.doesNotMatch(text, /secret|test-key/);
  });
for (const data of [
  {},
  { choices: [] },
  { choices: [{ message: { content: '' } }] },
  { choices: [{ message: { content: 33 } }] },
])
  test('handles malformed or empty upstream response', async () => {
    assert.equal(
      (await handleCoach(request(), async () => Response.json(data))).status,
      502,
    );
  });
test('handles invalid upstream JSON', async () =>
  assert.equal(
    (await handleCoach(request(), async () => new Response('not json'))).status,
    502,
  ));
for (const name of ['TimeoutError', 'AbortError', 'TypeError'])
  test(`sanitizes ${name}`, async () => {
    const r = await handleCoach(request(), async () => {
      const e = new Error('secret key');
      e.name = name;
      throw e;
    });
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(await r.json()), /secret key/);
  });
test('propagates caller cancellation to upstream', async () => {
  const controller = new AbortController();
  const req = new Request(request(), { signal: controller.signal });
  controller.abort();
  await handleCoach(req, async (_, options) => {
    assert.equal(options.signal.aborted, true);
    throw new DOMException('Aborted', 'AbortError');
  });
});

test('loads legacy drafts and preserves base/follow-up independently', () =>
  assert.deepEqual(
    readDrafts(
      '{"ttl":{"code":"base","followupCode":"next","done":true,"followupDone":false,"notes":"note"}}',
    ),
    {
      ttl: {
        code: 'base',
        followupCode: 'next',
        done: true,
        followupDone: false,
        notes: 'note',
      },
    },
  ));
test('drops unknown and mistyped saved fields', () =>
  assert.deepEqual(
    readDrafts(
      '{"ttl":{"code":4,"done":"false","apiKey":"secret","answer":"ok"},"bad":null}',
    ),
    { ttl: { answer: 'ok' } },
  ));
for (const value of ['[]', 'null', 'false', 'bad'])
  test(`rejects damaged draft root ${value}`, () =>
    assert.throws(() => readDrafts(value)));
test('empty storage initializes safely', () =>
  assert.deepEqual(readDrafts(null), {}));
test('prototype names cannot alter the drafts prototype', () => {
  const value = readDrafts('{"__proto__":{"code":"x"}}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(value.__proto__.code, 'x');
  assert.equal({}.code, undefined);
});
test('status reflects work and explicit review', () => {
  assert.equal(statusOf(), 'Not started');
  assert.equal(statusOf({ code: ' ' }), 'Not started');
  assert.equal(statusOf({ followupCode: 'pass' }), 'In progress');
  assert.equal(statusOf({ answer: 'answer' }), 'In progress');
  assert.equal(statusOf({ done: true }), 'Reviewed');
  assert.equal(statusOf({ done: false }), 'Not started');
});
const problems = [
  { id: 'a', title: 'Cache', topic: 'State' },
  { id: 'b', title: 'Graph', topic: 'Graphs' },
];
test('search ignores case and surrounding whitespace', () =>
  assert.deepEqual(filterProblems(problems, {}, ' CACHE '), [problems[0]]));
test('filters intersect topic, query and status', () => {
  assert.deepEqual(
    filterProblems(
      problems,
      { a: { done: true } },
      'state',
      'State',
      'Reviewed',
    ),
    [problems[0]],
  );
  assert.deepEqual(
    filterProblems(
      problems,
      { a: { done: true } },
      'state',
      'State',
      'In progress',
    ),
    [],
  );
});
test('does not mutate problem ordering', () => {
  filterProblems(problems, {}, '');
  assert.equal(problems[0].id, 'a');
});

// Structured coaching and application of code edits.
import {
  validateWalkthrough,
  validateWalkthroughPartial,
  acceptEdit,
} from '../lib/review.ts';
import { verdict, readSubmissions, addSubmission } from '../lib/submissions.ts';
import { readFileSync } from 'node:fs';
const source = 'x = 1\ny = 2\nprint(x + y)\n';
const walkthrough = {
  title: 'Fix the starting value',
  explanation: 'x is one too small.',
  hints: ['Check x.', 'Trace the first assignment.', 'Use 3.'],
  steps: ['Start with x = 1.', 'Change x to 3 and rerun.'],
  solution: 'The assignment is constant time.',
  edits: [
    {
      before: 'x = 1',
      after: 'x = 3',
      explanation: 'Initialize the correct value.',
    },
  ],
};
test('validates and strips extra fields from matching edits', () =>
  assert.deepEqual(
    validateWalkthrough({ ...walkthrough, extra: 'ignored' }, source),
    walkthrough,
  ));
for (const [name, value] of Object.entries({
  null: null,
  missing: {},
  hints: { ...walkthrough, hints: ['only one'] },
  steps: { ...walkthrough, steps: [] },
  emptyBefore: {
    ...walkthrough,
    edits: [{ before: '', after: 'x', explanation: 'x' }],
  },
  missingMatch: {
    ...walkthrough,
    edits: [{ before: 'x = 9', after: 'x = 3', explanation: 'x' }],
  },
  unchanged: {
    ...walkthrough,
    edits: [{ before: 'x = 1', after: 'x = 1', explanation: 'x' }],
  },
  overlap: {
    ...walkthrough,
    edits: [
      { before: 'x = 1', after: 'x = 3', explanation: 'x' },
      { before: '1\ny = 2', after: '2\ny = 2', explanation: 'y' },
    ],
  },
  tooMany: { ...walkthrough, edits: Array(7).fill(walkthrough.edits[0]) },
}))
  test(`rejects unsafe review: ${name}`, () =>
    assert.throws(() => validateWalkthrough(value, source)));
test('ambiguous repeated code cannot be edited', () =>
  assert.throws(() => validateWalkthrough(walkthrough, source + source)));
test('matches an edit when the model drifts on spacing', () =>
  assert.deepEqual(
    validateWalkthrough(
      {
        ...walkthrough,
        edits: [
          {
            before: 'print(x  +  y)',
            after: 'print((x + y))',
            explanation: 'clarity',
          },
        ],
      },
      source,
    ).edits,
    [
      {
        before: 'print(x + y)',
        after: 'print((x + y))',
        explanation: 'clarity',
      },
    ],
  ));
test('realigns continuation lines the model re-indented', () => {
  const code =
    'def total(xs):\n    if xs:\n        return sum(xs)\n    return 0\n';
  assert.deepEqual(
    validateWalkthrough(
      {
        ...walkthrough,
        edits: [
          {
            before: 'if xs:\n    return sum(xs)',
            after: 'if xs:\n    return sum(xs) + 1',
            explanation: 'include one',
          },
        ],
      },
      code,
    ).edits,
    [
      {
        before: 'if xs:\n        return sum(xs)',
        after: 'if xs:\n        return sum(xs) + 1',
        explanation: 'include one',
      },
    ],
  );
});
test('keeps a valid reply and drops only the edits that do not match', () => {
  const { walkthrough: w, dropped } = validateWalkthroughPartial(
    {
      ...walkthrough,
      edits: [
        walkthrough.edits[0],
        { before: 'does not exist', after: 'x', explanation: 'x' },
      ],
    },
    source,
  );
  assert.equal(dropped, 1);
  assert.equal(w.edits.length, 1);
  assert.equal(w.edits[0].before, 'x = 1');
  assert.equal(w.title, walkthrough.title);
});
test('drops every edit when none match but keeps the explanation', () => {
  const { walkthrough: w, dropped } = validateWalkthroughPartial(
    {
      ...walkthrough,
      edits: [{ before: 'nope', after: 'x', explanation: 'x' }],
    },
    source,
  );
  assert.equal(dropped, 1);
  assert.deepEqual(w.edits, []);
  assert.equal(w.solution, walkthrough.solution);
});
test('an empty edit list is valid feedback', () =>
  assert.equal(
    validateWalkthrough({ ...walkthrough, edits: [] }, source).edits.length,
    0,
  ));
test('accept changes only the selected exact range', () => {
  const p = {
    base: source,
    edits: [
      ...walkthrough.edits,
      { before: 'y = 2', after: 'y = 4', explanation: 'fix y' },
    ],
  };
  const first = acceptEdit(source, p, 0);
  assert.equal(first.code, 'x = 3\ny = 2\nprint(x + y)\n');
  assert.equal(first.proposal.edits.length, 1);
  assert.equal(
    acceptEdit(first.code, first.proposal, 0).code,
    'x = 3\ny = 4\nprint(x + y)\n',
  );
});
test('stale proposals never overwrite newer work', () =>
  assert.throws(
    () =>
      acceptEdit(
        source + '# new work',
        { base: source, edits: walkthrough.edits },
        0,
      ),
    /changed/,
  ));
test('invalid proposal index is rejected', () =>
  assert.throws(() =>
    acceptEdit(source, { base: source, edits: walkthrough.edits }, 2),
  ));
test('deletions preserve surrounding code', () =>
  assert.equal(
    acceptEdit(
      source,
      {
        base: source,
        edits: [{ before: 'y = 2\n', after: '', explanation: 'remove' }],
      },
      0,
    ).code,
    'x = 1\nprint(x + y)\n',
  ));
test('structured hint uses JSON format and exact candidate snapshot', async () => {
  let body;
  const r = await handleCoach(
    request({ ...payload, mode: 'hint', code: source }),
    async (_, options) => {
      body = JSON.parse(options.body);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(walkthrough) } }],
      });
    },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[1].content, /CANDIDATE_SOURCE/);
  assert.deepEqual((await r.json()).walkthrough, walkthrough);
});
test('malformed AI patch is rejected without leaking response', async () => {
  const r = await handleCoach(
    request({ ...payload, mode: 'debug', code: source }),
    async () =>
      Response.json({
        choices: [{ message: { content: '{"secret":"provider data"}' } }],
      }),
  );
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /No code was changed/);
});
test('coach keeps the explanation when no edit matches the code', async () => {
  const content = JSON.stringify({
    ...walkthrough,
    edits: [{ before: 'no such line', after: 'x = 2', explanation: 'x' }],
  });
  const r = await handleCoach(
    request({ ...payload, mode: 'hint', code: source }),
    async () => Response.json({ choices: [{ message: { content } }] }),
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.droppedEdits, 1);
  assert.deepEqual(body.walkthrough.edits, []);
  assert.equal(body.walkthrough.title, walkthrough.title);
});
test('an unmatched edit triggers one bounded repair pass', async () => {
  let calls = 0;
  const r = await handleCoach(
    request({ ...payload, mode: 'hint', code: source }),
    async () => {
      calls++;
      const body =
        calls === 1
          ? {
              ...walkthrough,
              edits: [
                {
                  before: 'not in the source',
                  after: 'x = 3',
                  explanation: 'x',
                },
              ],
            }
          : walkthrough;
      return Response.json({
        choices: [{ message: { content: JSON.stringify(body) } }],
      });
    },
  );
  assert.equal(calls, 2);
  const data = await r.json();
  assert.equal(data.repaired, true);
  assert.equal(data.droppedEdits, 0);
  assert.deepEqual(data.walkthrough.edits, walkthrough.edits);
});
test('a failed repair keeps the first reply instead of erroring', async () => {
  let calls = 0;
  const r = await handleCoach(
    request({ ...payload, mode: 'hint', code: source }),
    async () => {
      calls++;
      if (calls === 2)
        return new Response('upstream exploded', { status: 500 });
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...walkthrough,
                edits: [
                  {
                    before: 'not in the source',
                    after: 'x = 3',
                    explanation: 'x',
                  },
                ],
              }),
            },
          },
        ],
      });
    },
  );
  assert.equal(calls, 2);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.deepEqual(data.walkthrough.edits, []);
  assert.equal(data.droppedEdits, 1);
  assert.equal(data.repaired, undefined);
});
test('a fully matching reply is never sent for repair', async () => {
  let calls = 0;
  const r = await handleCoach(
    request({ ...payload, mode: 'hint', code: source }),
    async () => {
      calls++;
      return Response.json({
        choices: [{ message: { content: JSON.stringify(walkthrough) } }],
      });
    },
  );
  assert.equal(calls, 1);
  assert.equal(r.status, 200);
});
test('oversized source is rejected before calling DeepSeek', async () =>
  assert.equal(
    (await handleCoach(request({ ...payload, code: 'x'.repeat(20001) }), never))
      .status,
    400,
  ));
for (const mode of ['explain', 'approach', 'complexity'])
  test(`supports ${mode} review`, async () =>
    assert.equal(
      (
        await handleCoach(request({ ...payload, mode }), async () =>
          Response.json({
            choices: [{ message: { content: 'An explanation' } }],
          }),
        )
      ).status,
      200,
    ));
const saved = {
  id: 'one',
  problemId: 'ttl',
  stage: 'base',
  code: 'print(1)',
  at: '2026-09-21T12:00:00Z',
  result: {
    output: '',
    results: [{ name: 'test', passed: true }],
    durationMs: 10,
  },
};
test('submission verdicts reflect evidence', () => {
  assert.equal(verdict(saved.result), 'Accepted');
  assert.equal(
    verdict({
      output: '',
      results: [{ name: 'test', passed: false, error: 'AssertionError' }],
    }),
    'Wrong Answer',
  );
  assert.equal(
    verdict({ output: '', results: [], timeout: true }),
    'Time Limit Exceeded',
  );
  assert.equal(
    verdict({ output: '', results: [], error: 'SyntaxError' }),
    'Runtime Error',
  );
  assert.equal(verdict({ output: '', results: [] }), 'No test results');
});
const traceback = (kind, message) =>
  `Traceback (most recent call last):\n  File "test: expiry", line 4, in <module>\n    assert store.get("a") == "b"\n${kind}: ${message}\n`;
test('a crash is a runtime error, not a wrong answer', () => {
  for (const kind of [
    'KeyError',
    'IndexError',
    'ZeroDivisionError',
    'RecursionError',
    'AttributeError',
  ])
    assert.equal(
      verdict({
        output: '',
        results: [{ name: 'test', passed: false, error: traceback(kind, 'x') }],
      }),
      'Runtime Error',
      kind,
    );
  assert.equal(
    verdict({
      output: '',
      results: [
        {
          name: 'test',
          passed: false,
          error: traceback('AssertionError', '1 == 2'),
        },
      ],
    }),
    'Wrong Answer',
  );
});
test('follow-up progress and review count toward the library status', () => {
  assert.equal(statusOf({ followupNotes: 'thoughts' }), 'In progress');
  assert.equal(statusOf({ followupCode: 'print(1)' }), 'In progress');
  assert.equal(statusOf({ followupDone: true }), 'Reviewed');
  assert.equal(statusOf({ done: true, followupDone: true }), 'Reviewed');
  assert.equal(statusOf({ notes: '   ' }), 'Not started');
  assert.equal(statusOf(undefined), 'Not started');
});
test('submission history round-trips and rejects malformed records', () => {
  assert.deepEqual(
    readSubmissions(
      JSON.stringify([
        saved,
        null,
        { ...saved, result: { results: 'bad' } },
        { ...saved, at: 'invalid' },
        { ...saved, result: { ...saved.result, durationMs: -1 } },
      ]),
    ),
    [saved],
  );
  assert.throws(() => readSubmissions('{}'));
});
test('submission history is bounded and newest-first', () => {
  const history = Array.from({ length: 100 }, (_, i) => ({
    ...saved,
    id: String(i),
  }));
  const next = addSubmission(history, saved);
  assert.equal(next.length, 100);
  assert.equal(next[0].id, 'one');
  assert.equal(history.length, 100);
});
test('every coding stage has a formatted statement and explained runnable example', () => {
  const data = JSON.parse(
    readFileSync(new URL('../app/data/problem-content.json', import.meta.url)),
  );
  for (const file of ['coding', 'followups'])
    for (const problem of JSON.parse(
      readFileSync(new URL(`../app/data/${file}.json`, import.meta.url)),
    )) {
      const item = data[problem.id + (file === 'followups' ? ':followup' : '')];
      assert.ok(item, problem.id);
      assert.ok(item.overview.length > 50);
      assert.ok(item.requirements.length);
      assert.ok(item.examples.length);
      for (const example of item.examples) {
        assert.ok(example.code);
        assert.ok(example.output);
        assert.ok(example.explanation.length > 20);
      }
    }
});
