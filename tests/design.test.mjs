import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDesign, scoreFrom } from '../lib/design-grader.ts';
import {
  migrateDrafts,
  readDesignDraft,
  readDrafts,
  statusOf,
} from '../lib/practice.ts';
import {
  DESIGN_SECTIONS,
  MAX_FOLLOWUPS,
  MAX_SECTION_SCORE,
  SECTION_IDS,
  guidanceOf,
  isSectionId,
  scorecard,
} from '../lib/design.ts';

const grade = {
  problemId: 'design-jobs',
  section: 'scope',
  title: 'Scope & requirements',
  prompt: 'Agree what the system does.',
  answer: 'A queue in front of workers, results in S3.',
  rubric: [
    'Names the client-facing submit and status operations.',
    'Says what is explicitly out of scope.',
    'Names the guarantee for an accepted job.',
  ],
  probes: ['How do you measure admission load?'],
  failures: [],
  turns: [],
  lastChance: false,
};
function request(body = grade, headers = {}) {
  return new Request('http://localhost:3000/api/design', {
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
/** Replies with a sequence of model outputs, recording each request body. */
function model(...replies) {
  const seen = [];
  let call = 0;
  const fetcher = async (_url, init) => {
    seen.push(JSON.parse(init.body));
    const body = replies[call++];
    if (typeof body === 'string' && body.startsWith('throw:'))
      return new Response(body.slice(6), { status: Number(body.slice(6)) });
    if (typeof body === 'string')
      return new Response(
        JSON.stringify({ choices: [{ message: { content: body } }] }),
        { status: 200 },
      );
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(body) } }],
      }),
      { status: 200 },
    );
  };
  return { fetcher, seen };
}
const never = async () => {
  throw new Error('Upstream must not be called');
};

test('the section list covers a 60 minute interview once', () => {
  assert.equal(DESIGN_SECTIONS.length, 6);
  assert.equal(
    DESIGN_SECTIONS.reduce((n, s) => n + s.minutes, 0),
    60,
  );
  assert.equal(new Set(SECTION_IDS).size, SECTION_IDS.length);
  for (const s of DESIGN_SECTIONS) assert.ok(s.prompt.trim().length > 80);
});

test('the grader is sent the rubric, the section and the follow-up history', async () => {
  const { fetcher, seen } = model({
    met: ['r1'],
    strengths: ['Named the submit path.'],
    gaps: [],
    followUp: '',
  });
  const r = await handleDesign(
    request({
      ...grade,
      turns: [{ question: 'What about retries?', answer: 'At least once.' }],
    }),
    fetcher,
  );
  assert.equal(r.status, 200);
  const sent = seen[0].messages[1].content;
  assert.match(sent, /SECTION: Scope & requirements/);
  assert.match(sent, /r1: Names the client-facing submit/);
  assert.match(sent, /Q1: What about retries\?/);
  assert.match(sent, /ANSWER:\nA queue in front of workers/);
  // The rubric must be labelled so the model can only return real ids.
  assert.match(sent, /r3: Names the guarantee/);
});

test('the score comes from rubric items met, never from the model', async () => {
  const { fetcher } = model({
    met: ['r1', 'r2'],
    // A model claiming a perfect score must not be believed.
    score: 4,
    strengths: [],
    gaps: [],
    followUp: '',
  });
  const r = await handleDesign(request(), fetcher);
  const body = await r.json();
  assert.equal(body.score, scoreFrom(2, 3));
  assert.equal(body.score, 3);
  assert.equal(body.met, 2);
  assert.equal(body.total, 3);
});

test('a hallucinated rubric id cannot inflate the score', async () => {
  const { fetcher } = model({
    met: ['r1', 'r99', 'r2', 'r3', 'r3', 'banana'],
    strengths: [],
    gaps: [],
    followUp: '',
  });
  const body = await (await handleDesign(request(), fetcher)).json();
  assert.equal(body.met, 3);
  assert.equal(body.score, MAX_SECTION_SCORE);
});

test('scores stay inside the section maximum however many items are met', () => {
  assert.equal(scoreFrom(0, 3), 0);
  assert.equal(scoreFrom(1, 3), 1);
  assert.equal(scoreFrom(2, 3), 3);
  assert.equal(scoreFrom(3, 3), 4);
  assert.equal(scoreFrom(9, 3), MAX_SECTION_SCORE);
  assert.equal(scoreFrom(1, 0), 0);
});

test('one follow-up question is kept and the rest are dropped', async () => {
  const { fetcher } = model({
    met: ['r1'],
    strengths: ['a', 'b', 'c', 'd'],
    gaps: ['x', 'y', 'z', 'w'],
    followUp: ['First question?', 'Second question?'],
  });
  const body = await (await handleDesign(request(), fetcher)).json();
  assert.equal(body.followUp, 'First question?');
  assert.equal(body.strengths.length, 3);
  assert.equal(body.gaps.length, 3);
});

test('an empty follow-up means the section passed, whatever the score', async () => {
  const { fetcher } = model({ met: [], followUp: '' });
  const body = await (await handleDesign(request(), fetcher)).json();
  assert.equal(body.followUp, '');
  assert.equal(body.score, 0);
});

test('a normal string follow-up survives the model response parser', async () => {
  const { fetcher } = model({
    met: ['r1'],
    strengths: [],
    gaps: ['No retry policy.'],
    followUp: '  How do you make a retried submission safe?  ',
  });
  const body = await (await handleDesign(request(), fetcher)).json();
  assert.equal(body.followUp, 'How do you make a retried submission safe?');
});

test('missing or malformed follow-up cannot silently finish a section', async () => {
  for (const followUp of [undefined, 42, {}, ['']]) {
    const { fetcher } = model({ met: [], followUp }, { met: [], followUp });
    const response = await handleDesign(request(), fetcher);
    assert.equal(response.status, 502);
  }
});

test('the interviewer receives the scenario requirements and assumptions', async () => {
  const { fetcher, seen } = model({ met: [], followUp: '' });
  const response = await handleDesign(
    request({
      ...grade,
      scenarioTitle: 'Durable job execution platform',
      scenarioStatement:
        'Run long-lived jobs safely after acknowledging acceptance.',
      assumptions: ['Ten million jobs per day.', 'At-least-once execution.'],
    }),
    fetcher,
  );
  assert.equal(response.status, 200);
  const sent = seen[0].messages[1].content;
  assert.match(sent, /Durable job execution platform/);
  assert.match(sent, /Run long-lived jobs safely/);
  assert.match(sent, /Ten million jobs per day/);
});

test('scenario context is bounded before calling DeepSeek', async () => {
  for (const fields of [
    { scenarioTitle: 12 },
    { scenarioStatement: 'x'.repeat(8001) },
    { assumptions: ['x'.repeat(1001)] },
    { assumptions: 'invalid' },
  ]) {
    assert.equal(
      (await handleDesign(request({ ...grade, ...fields }), never)).status,
      400,
    );
  }
});

test('an unsent follow-up draft survives storage and rejects malformed reply data', () => {
  const restored = readDesignDraft({
    sections: {
      scope: {
        answer: 'A durable queue.',
        turns: [],
        pending: 'What if it fails?',
        reply: 'Use the stable job ID.',
      },
      data: { answer: 'A job table.', turns: [], reply: { unsafe: true } },
    },
  });
  assert.equal(restored.sections.scope.reply, 'Use the stable job ID.');
  assert.equal(restored.sections.data.reply, undefined);
});

test('the last chance is announced so the model spends its final question', async () => {
  const { fetcher, seen } = model({
    met: [],
    followUp: 'Still missing the retry story.',
  });
  await handleDesign(request({ ...grade, lastChance: true }), fetcher);
  assert.match(seen[0].messages[1].content, /last chance/);
});

test('an injected failure scenario reaches the grader with its section', async () => {
  const { fetcher, seen } = model({ met: [], followUp: '' });
  await handleDesign(
    request({
      ...grade,
      section: 'failure',
      failures: ['A GPU pool loses 30% of capacity.'],
      probes: [],
    }),
    fetcher,
  );
  const sent = seen[0].messages[1].content;
  assert.match(sent, /raised this before you were answered/);
  assert.match(sent, /A GPU pool loses 30% of capacity\./);
});

test('an unreadable grading is retried once and never saved half-applied', async () => {
  const { fetcher, seen } = model('not json at all', {
    met: ['r1', 'r2', 'r3'],
    followUp: '',
  });
  const r = await handleDesign(request(), fetcher);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).score, MAX_SECTION_SCORE);
  assert.equal(seen.length, 2);
});

test('a grading the model cannot produce twice is an error, not a zero', async () => {
  const { fetcher } = model('garbage', 'still garbage');
  const r = await handleDesign(request(), fetcher);
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /could not read/i);
});

/** @type {Array<[string, Record<string, unknown>, number]>} */
const invalidGradeCases = [
  ['a non-object body', { ...grade, rubric: undefined }, 400],
  ['an unknown section', { ...grade, section: 'nope' }, 400],
  ['an empty answer', { ...grade, answer: '   ' }, 400],
  ['an empty rubric', { ...grade, rubric: [] }, 400],
  ['an oversized answer', { ...grade, answer: 'x'.repeat(8001) }, 400],
  ['a malformed turn', { ...grade, turns: [{ question: 1 }] }, 400],
  [
    'too many turns',
    { ...grade, turns: Array.from({ length: 9 }, () => ({ question: 'q', answer: 'a' })) },
    400,
  ],
  ['a missing last-chance flag', { ...grade, lastChance: 'yes' }, 400],
];
for (const [name, mutate, status] of invalidGradeCases) {
  test(`rejects ${name}`, async () => {
    assert.equal((await handleDesign(request(mutate), never)).status, status);
  });
}

test('the grader shares the coach request preconditions', async () => {
  assert.equal(
    (
      await handleDesign(
        request(grade, { origin: 'https://other.example' }),
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (await handleDesign(request(grade, { authorization: '' }), never)).status,
    401,
  );
  assert.equal(
    (
      await handleDesign(
        request(grade, { 'content-type': 'text/plain' }),
        never,
      )
    ).status,
    415,
  );
  assert.equal((await handleDesign(request('{bad'), never)).status, 400);
  assert.equal(
    (await handleDesign(request('a'.repeat(100001)), never)).status,
    413,
  );
});

test('upstream failures are reported to the candidate', async () => {
  for (const [code, match] of [
    [401, /rejected this key/],
    [402, /needs credit/],
    [429, /rate limited/],
  ]) {
    const { fetcher } = model(`throw:${code}`);
    const r = await handleDesign(request(), fetcher);
    assert.equal(r.status, code);
    assert.match((await r.json()).error, match);
  }
});

test('guidance is reported separately from the rubric score', () => {
  assert.equal(guidanceOf(0, true), 'unaided');
  assert.equal(guidanceOf(1, true), 'guided');
  assert.equal(guidanceOf(2, true), 'heavy');
  assert.equal(guidanceOf(MAX_FOLLOWUPS, false), 'revealed');
  // A perfect score that needed help is still reported as guided.
  assert.equal(guidanceOf(2, true), 'heavy');
});

test('the scorecard totals graded sections only', () => {
  const empty = scorecard(undefined);
  assert.deepEqual(empty, {
    earned: 0,
    possible: 0,
    graded: 0,
    unaided: 0,
    total: 6,
  });
  const partial = scorecard({
    sections: {
      scope: {
        answer: 'a',
        turns: [],
        grade: {
          score: 4,
          met: 3,
          total: 3,
          strengths: [],
          gaps: [],
          passed: true,
        },
      },
      estimates: {
        answer: 'a',
        turns: [{ question: 'q', answer: 'a', score: 1, met: 1, total: 3 }],
        grade: {
          score: 1,
          met: 1,
          total: 3,
          strengths: [],
          gaps: [],
          passed: false,
        },
      },
      data: { answer: 'drafted but never graded', turns: [] },
    },
  });
  assert.equal(partial.graded, 2);
  assert.equal(partial.earned, 5);
  assert.equal(partial.possible, MAX_SECTION_SCORE * 2);
  assert.equal(partial.unaided, 1);
});

test('section ids are validated against the shared list', () => {
  for (const id of SECTION_IDS) assert.equal(isSectionId(id), true);
  assert.equal(isSectionId('reviews'), false);
  assert.equal(isSectionId(7), false);
  assert.equal(isSectionId(null), false);
});

test('a saved design draft round-trips through local storage', () => {
  const stored = JSON.stringify({
    'design-jobs': {
      design: {
        sections: {
          scope: {
            answer: 'A durable queue with leases.',
            turns: [
              {
                question: 'Why?',
                answer: 'Because leases expire.',
                score: 2,
                met: 2,
                total: 3,
              },
            ],
            pending: 'And if the worker stalls?',
            grade: {
              score: 2,
              met: 2,
              total: 3,
              strengths: ['Named the durability boundary.'],
              gaps: ['No fencing token yet.'],
              passed: false,
            },
          },
        },
      },
    },
  });
  const draft = readDrafts(stored)['design-jobs'];
  assert.equal(
    draft.design.sections.scope.answer,
    'A durable queue with leases.',
  );
  assert.equal(
    draft.design.sections.scope.pending,
    'And if the worker stalls?',
  );
  assert.equal(draft.design.sections.scope.turns.length, 1);
  assert.equal(draft.design.sections.scope.grade.score, 2);
  assert.equal(draft.design.sections.scope.grade.passed, false);
});

test('a malformed design block is dropped rather than half-restored', () => {
  // The outer shape is wrong, so the whole block goes.
  for (const bad of [
    { design: 'nope' },
    { design: [] },
    { design: { sections: 'nope' } },
    { design: { sections: null } },
  ]) {
    const draft = readDrafts(JSON.stringify({ x: bad })).x;
    assert.equal(draft.design, undefined, JSON.stringify(bad));
  }
  // The shape is right but every entry is junk, so nothing is restored. An
  // empty draft is still a valid draft, and must not look like work.
  for (const bad of [
    { design: { sections: { scope: { answer: 42 } } } },
    { design: { sections: { unknown: { answer: 'x' } } } },
  ]) {
    const draft = readDrafts(JSON.stringify({ x: bad })).x;
    assert.deepEqual(draft.design, { sections: {} }, JSON.stringify(bad));
  }
});

test('a junk grade is dropped without discarding the answer it belonged to', () => {
  const draft = readDrafts(
    JSON.stringify({
      x: {
        design: {
          sections: {
            scope: {
              answer: 'My work',
              turns: [{ question: 'q', answer: 'a', score: 99 }],
              grade: { score: 99, met: 1, total: 3, strengths: [], gaps: [] },
            },
          },
        },
      },
    }),
  ).x;
  const scope = draft.design.sections.scope;
  assert.equal(scope.answer, 'My work');
  assert.equal(scope.grade, undefined);
  assert.deepEqual(scope.turns, []);
  // Losing the grade means the section reads as unfinished, not as done.
  assert.equal(statusOf(draft), 'In progress');
});

test('an empty design section is not stored as work in progress', () => {
  const draft = readDrafts(
    JSON.stringify({
      x: { design: { sections: { scope: { answer: '  ' } } } },
    }),
  ).x;
  assert.deepEqual(draft.design, { sections: {} });
  assert.equal(statusOf(draft), 'Not started');
});

test('a design out-of-range score is rejected, not clamped silently', () => {
  const draft = readDrafts(
    JSON.stringify({
      x: {
        design: {
          sections: {
            scope: {
              answer: 'a',
              grade: { score: 7, met: 1, total: 3, strengths: [], gaps: [] },
            },
          },
        },
      },
    }),
  ).x;
  assert.equal(draft.design.sections.scope.grade, undefined);
});

test('a pre-section-flow design answer becomes the first section', () => {
  const restored = readDrafts(
    JSON.stringify({ x: { answer: 'My old design' } }),
  );
  migrateDrafts(restored);
  assert.equal(restored.x.design.sections.scope.answer, 'My old design');
  // The original is untouched, so nothing the candidate wrote is lost.
  assert.equal(restored.x.answer, 'My old design');
  assert.equal(statusOf(restored.x), 'In progress');
});

test('migration never overwrites a section flow that already exists', () => {
  const restored = readDrafts(
    JSON.stringify({
      x: {
        answer: 'My old design',
        design: { sections: { scope: { answer: 'My new answer', turns: [] } } },
      },
    }),
  );
  migrateDrafts(restored);
  assert.equal(restored.x.design.sections.scope.answer, 'My new answer');
});

test('a design counts as reviewed only once every section is finished', () => {
  const grade = (passed) => ({
    score: 2,
    met: 2,
    total: 3,
    strengths: [],
    gaps: [],
    passed,
  });
  const partial = readDesignDraft({
    sections: { scope: { answer: 'a', turns: [], grade: grade(true) } },
  });
  assert.equal(statusOf({ design: partial }), 'In progress');
  const spent = {};
  for (const id of SECTION_IDS)
    spent[id] = {
      answer: 'a',
      turns: Array.from({ length: MAX_FOLLOWUPS }, () => ({
        question: 'q',
        answer: 'a',
        score: 1,
        met: 1,
        total: 3,
      })),
      grade: grade(false),
    };
  assert.equal(
    statusOf({ design: readDesignDraft({ sections: spent }) }),
    'Reviewed',
  );
});
