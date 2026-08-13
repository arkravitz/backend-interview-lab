/**
 * Where the candidate is, expressed as a URL.
 *
 * A refresh should put you back where you were, and a link to a problem should
 * open that problem. Both fall out of keeping the location in the query string
 * rather than in component state, and both are worth more than the handful of
 * lines they cost.
 *
 * Defaults are omitted so a pristine URL stays clean: the library at the first
 * coding problem is just `/`.
 */
export type View = 'library' | 'problem';

export type ViewState = {
  view: View;
  track: 'coding' | 'design';
  /** Problem id. Always a real id for the chosen track, even on the library. */
  id: string;
  stage: 'base' | 'followup';
  query: string;
  topic: string;
  status: string;
};

export const DEFAULT_VIEW: ViewState = {
  view: 'library',
  track: 'coding',
  id: '',
  stage: 'base',
  query: '',
  topic: 'All topics',
  status: 'All statuses',
};

const VIEWS: View[] = ['library', 'problem'];
const TRACKS = ['coding', 'design'] as const;

/** Tracks that have a follow-up stage at all. */
const hasFollowup = (track: ViewState['track']) => track === 'coding';

/**
 * Reads a location out of a query string, discarding anything unrecognised.
 *
 * `known` supplies the valid ids per track, so a stale or hand-edited link
 * falls back to the track's first problem rather than rendering nothing.
 */
export function parseView(
  search: string,
  known: { coding: readonly string[]; design: readonly string[] },
  topics: readonly string[],
  base: ViewState = DEFAULT_VIEW,
): ViewState {
  const params = new URLSearchParams(search);
  const pick = (key: string) => params.get(key) ?? undefined;

  const trackRaw = pick('track');
  const track = TRACKS.includes(trackRaw as never)
    ? (trackRaw as never)
    : base.track;

  const viewRaw = pick('view');
  const view = VIEWS.includes(viewRaw as View) ? (viewRaw as View) : base.view;

  const ids = known[track];
  const idRaw = pick('id');
  const id = idRaw && ids.includes(idRaw) ? idRaw : (ids[0] ?? base.id);

  const stageRaw = pick('stage');
  const stage =
    stageRaw === 'followup' && hasFollowup(track) ? 'followup' : 'base';

  const topicRaw = pick('topic');
  const statusRaw = pick('status');

  return {
    view,
    track,
    id,
    stage,
    query: (pick('q') ?? base.query).slice(0, 200),
    topic: topicRaw && topics.includes(topicRaw) ? topicRaw : base.topic,
    // Statuses are a fixed vocabulary rather than a data-derived list.
    status: ['All statuses', 'Not started', 'In progress', 'Reviewed'].includes(
      statusRaw ?? '',
    )
      ? (statusRaw as string)
      : base.status,
  };
}

/**
 * The inverse. Only non-default values are written, so the common case is a
 * bare `/` and a filtered library reads as a short, readable query.
 */
export function buildSearch(state: ViewState, base = DEFAULT_VIEW): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string, fallback: string) => {
    if (value && value !== fallback) params.set(key, value);
  };
  put('view', state.view, base.view);
  put('track', state.track, base.track);
  // The id and stage only mean anything on a problem. The library always has
  // some id selected internally, so writing it would leave every library url
  // carrying ?id=... and there would be no such thing as a clean address.
  if (state.view === 'problem') {
    put('id', state.id, base.id);
    put('stage', state.stage, base.stage);
  }
  put('q', state.query, base.query);
  put('topic', state.topic, base.topic);
  put('status', state.status, base.status);
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Fields whose change is a navigation rather than an in-place adjustment. */
export function isNavigation(next: ViewState, prev: ViewState): boolean {
  return (
    next.view !== prev.view ||
    next.track !== prev.track ||
    next.id !== prev.id ||
    next.stage !== prev.stage
  );
}
