import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEW,
  buildSearch,
  isNavigation,
  parseView,
} from '../lib/view-state.ts';

const known = { coding: ['ttl', 'limiter'], design: ['design-jobs'] };
const topics = ['Hashing', 'Concurrency'];

test('a pristine url is the library at the first coding problem', () => {
  const state = parseView('', known, topics);
  assert.equal(state.view, 'library');
  assert.equal(state.track, 'coding');
  assert.equal(state.id, 'ttl');
  // A pristine url must round-trip to nothing, or the address bar fills up.
  assert.equal(buildSearch(state), '');
});

test('a problem survives a round trip through the url', () => {
  const state = parseView(
    '?view=problem&id=limiter&stage=followup',
    known,
    topics,
  );
  assert.equal(state.view, 'problem');
  assert.equal(state.id, 'limiter');
  assert.equal(state.stage, 'followup');
  assert.deepStrictEqual(parseView(buildSearch(state), known, topics), state);
});

test('the design track and its filters round trip', () => {
  const search = buildSearch({
    ...DEFAULT_VIEW,
    view: 'problem',
    track: 'design',
    id: 'design-jobs',
    query: 'queue',
    topic: 'Concurrency',
    status: 'In progress',
  });
  assert.equal(
    search,
    '?view=problem&track=design&id=design-jobs&q=queue&topic=Concurrency&status=In+progress',
  );
  assert.deepEqual(parseView(search, known, topics), {
    view: 'problem',
    track: 'design',
    id: 'design-jobs',
    stage: 'base',
    query: 'queue',
    topic: 'Concurrency',
    status: 'In progress',
  });
});

test('an unknown id falls back rather than rendering nothing', () => {
  // The most likely cause is a renamed or deleted problem in an old bookmark.
  const state = parseView('?view=problem&id=does-not-exist', known, topics);
  assert.equal(state.id, 'ttl');
  assert.equal(state.view, 'problem');
});

test('an id from the other track falls back to that tracks first problem', () => {
  const state = parseView('?track=design&id=ttl', known, topics);
  assert.equal(state.track, 'design');
  assert.equal(state.id, 'design-jobs');
});

test('unrecognised values are discarded rather than trusted', () => {
  const state = parseView(
    '?view=nowhere&track=python&topic=Nonsense&status=Maybe&q=x',
    known,
    topics,
  );
  assert.equal(state.view, 'library');
  assert.equal(state.track, 'coding');
  assert.equal(state.topic, 'All topics');
  assert.equal(state.status, 'All statuses');
  assert.equal(state.query, 'x');
});

test('a follow-up stage survives on the coding track', () => {
  assert.equal(
    parseView('?track=coding&stage=followup&id=ttl', known, topics).stage,
    'followup',
  );
});

test('a design track can never claim a follow-up stage', () => {
  assert.equal(
    parseView('?track=design&stage=followup&id=design-jobs', known, topics)
      .stage,
    'base',
  );
});

test('an absurd search term is truncated rather than stored whole', () => {
  const state = parseView(`?q=${'x'.repeat(500)}`, known, topics);
  assert.equal(state.query.length, 200);
});

test('filters are only written when they differ from the default', () => {
  assert.equal(buildSearch({ ...DEFAULT_VIEW, query: '' }), '');
  assert.equal(buildSearch({ ...DEFAULT_VIEW, query: 'ttl' }), '?q=ttl');
  // A topic equal to the default is noise in the address bar.
  assert.equal(buildSearch({ ...DEFAULT_VIEW, topic: 'All topics' }), '');
});

test('opening a problem is a navigation, filtering is not', () => {
  const library = { ...DEFAULT_VIEW, id: 'ttl' };
  assert.equal(
    isNavigation({ ...library, view: 'problem' }, library),
    true,
    'opening a problem should be a history entry',
  );
  assert.equal(
    isNavigation({ ...library, query: 'lim' }, library),
    false,
    'typing in a filter must not push a history entry per keystroke',
  );
  assert.equal(isNavigation({ ...library, topic: 'Hashing' }, library), false);
  assert.equal(isNavigation({ ...library, stage: 'followup' }, library), true);
  assert.equal(
    isNavigation({ ...library, track: 'design', id: 'design-jobs' }, library),
    true,
  );
});

test('obsolete practice-plan links fall back to the general library', () => {
  assert.equal(parseView('?view=guide', known, topics).view, 'library');
});
