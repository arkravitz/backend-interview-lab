/* oxlint-disable react/react-compiler -- Hydrate browser-only storage after SSR and report storage failures. */
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PracticeWorkspace } from '@/components/practice-workspace';
import { DifficultyBadge } from '@/components/difficulty-badge';
import {
  migrateDrafts,
  readDrafts,
  statusOf,
  filterProblems,
  type Draft,
} from '@/lib/practice';
import {
  addSubmission,
  readSubmissions,
  type Submission,
} from '@/lib/submissions';
import {
  buildSearch,
  isNavigation,
  parseView,
  type View,
  type ViewState,
} from '@/lib/view-state';
import {
  Code2,
  Network,
  Download,
  Settings2,
  Search,
  ArrowRight,
  CheckCircle2,
  Circle,
  Moon,
  Sun,
} from 'lucide-react';
import coding from './data/coding.json';
import designs from './data/design.json';
import designAnswers from './data/design-answers.json';
const ASSIST_KEY = 'interview-lab-autocomplete';
const KEY = 'interview-lab-v1',
  AI_KEY = 'interview-lab-deepseek-key',
  HISTORY_KEY = 'interview-lab-submissions-v1';
const failureScenarios = designAnswers.reduce(
  (n, d) => n + (d.failures || []).length,
  0,
);
export default function Home() {
  const [track, setTrack] = useState<ViewState['track']>('coding'),
    [id, setId] = useState(coding[0].id),
    [library, setLibrary] = useState(true),
    [query, setQuery] = useState(''),
    [topic, setTopic] = useState('All topics'),
    [status, setStatus] = useState('All statuses'),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [submissions, setSubmissions] = useState<Submission[]>([]),
    [loaded, setLoaded] = useState(false),
    [notice, setNotice] = useState(''),
    [apiKey, setApiKey] = useState(''),
    [settings, setSettings] = useState(false),
    [keyInput, setKeyInput] = useState(''),
    [dark, setDark] = useState(false),
    [stage, setStage] = useState<ViewState['stage']>('base'),
    [mock, setMock] = useState(false),
    [assist, setAssist] = useState(false);
  const latest = useRef({ track, id, drafts, stage });
  // Where the candidate is, mirrored into the query string so a refresh puts
  // them back here and a link to a problem opens that problem. Parsed in
  // lib/view-state.ts, which is pure and unit-tested.
  const view: View = library ? 'library' : 'problem';
  const known = useMemo(
    () => ({
      coding: coding.map((p) => p.id),
      design: designs.map((p) => p.id),
    }),
    [],
  );
  const topics = useMemo(
    () => [...new Set([...coding, ...designs].map((p) => p.topic))],
    [],
  );
  const [placed, setPlaced] = useState(false);
  const previous = useRef<ViewState | null>(null);
  const applyView = useCallback((next: ViewState) => {
    setTrack(next.track);
    setId(next.id);
    setStage(next.stage);
    setQuery(next.query);
    setTopic(next.topic);
    setStatus(next.status);
    setLibrary(next.view === 'library');
  }, []);
  // Hydrate from the URL, and follow Back and Forward. Written as raw History
  // calls rather than the router: a router navigation would remount the
  // workspace, which tears down the editor and aborts requests in flight.
  useEffect(() => {
    const read = () =>
      applyView(parseView(window.location.search, known, topics));
    read();
    setPlaced(true);
    const onPop = () => {
      read();
      // The mirror effect below sees the search already matching, so it will
      // not push a second entry for a history move the browser just made.
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyView, known, topics]);
  useEffect(() => {
    if (!placed) return;
    const next: ViewState = { view, track, id, stage, query, topic, status };
    const before = previous.current;
    previous.current = next;
    if (buildSearch(next) === window.location.search) return;
    const url = window.location.pathname + buildSearch(next);
    // Opening a problem is a navigation worth a history entry; typing in a
    // filter is not, and would make Back useless.
    if (before && isNavigation(next, before))
      window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [placed, view, track, id, stage, query, topic, status]);
  // Storage we could not parse is left on disk untouched: overwriting it with
  // an empty state would destroy the only remaining copy.
  const unreadable = useRef({ drafts: false, history: false });
  // Stable identities: the editor rebuilds its extensions when these change,
  // which would tear down the inline Accept/Reject buttons mid-interaction.
  const onPatch = useCallback(
    (change: Partial<Draft>) =>
      setDrafts((old) => ({ ...old, [id]: { ...old[id], ...change } })),
    [id],
  );
  const onSubmit = useCallback(
    (s: Submission) => setSubmissions((old) => addSubmission(old, s)),
    [],
  );
  // The practice clock and any standard input live here, above the per-problem
  // workspace, so switching problem or stage no longer silently resets them.
  const [clock, setClock] = useState({ seconds: 3600, running: false }),
    [stdinState, setStdinState] = useState({ id: '', text: '' });
  const endAt = useRef(0);
  useEffect(() => {
    if (!clock.running) return;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setClock((c) => ({ ...c, seconds: left, running: left > 0 }));
      if (!left)
        setNotice('Time is up. Review your approach before continuing.');
    }, 250);
    return () => clearInterval(interval);
  }, [clock.running]);
  const toggleClock = useCallback(() => {
    setClock((c) => {
      if (!c.running) endAt.current = Date.now() + c.seconds * 1000;
      return { ...c, running: !c.running };
    });
  }, []);
  const resetClock = useCallback(
    () => setClock({ seconds: 3600, running: false }),
    [],
  );
  // Standard input is per problem: it survives a stage switch but never leaks
  // into a different problem's test run.
  const onStdin = useCallback(
    (text: string) => setStdinState({ id, text }),
    [id],
  );
  useEffect(() => {
    latest.current = { track, id, drafts, stage };
  }, [track, id, drafts, stage]);
  useEffect(() => {
    const failed: string[] = [];
    try {
      setApiKey(localStorage.getItem(AI_KEY) || '');
      setDark(localStorage.getItem('interview-lab-theme') === 'dark');
      setAssist(localStorage.getItem(ASSIST_KEY) === 'on');
    } catch {}
    try {
      const restored = readDrafts(localStorage.getItem(KEY));
      migrateDrafts(restored);
      setDrafts(restored);
    } catch {
      unreadable.current.drafts = true;
      failed.push('Saved drafts');
    }
    try {
      setSubmissions(readSubmissions(localStorage.getItem(HISTORY_KEY)));
    } catch {
      unreadable.current.history = true;
      failed.push('Submission history');
    }
    if (failed.length)
      setNotice(
        `${failed.join(' and ')} could not be read. The old value is kept until you edit something. Export your work before you start.`,
      );
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded || (unreadable.current.drafts && !Object.keys(drafts).length))
      return;
    try {
      localStorage.setItem(KEY, JSON.stringify(drafts));
      unreadable.current.drafts = false;
    } catch {
      setNotice(
        'Browser storage is full or unavailable. Export your work to keep it.',
      );
    }
  }, [drafts, loaded]);
  useEffect(() => {
    if (!loaded || (unreadable.current.history && !submissions.length)) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(submissions));
      unreadable.current.history = false;
    } catch {
      setNotice(
        'Submission history could not be saved. Export your work to keep it.',
      );
    }
  }, [submissions, loaded]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    if (loaded)
      try {
        localStorage.setItem('interview-lab-theme', dark ? 'dark' : 'light');
      } catch {}
  }, [dark, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(ASSIST_KEY, assist ? 'on' : 'off');
    } catch {}
  }, [assist, loaded]);
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (t: unknown, o: unknown) => Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const validate = (input: unknown) => {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length
      )
        throw new Error('Expected an empty object');
    };
    for (const tool of [
      {
        name: 'list_practice_problems',
        description: 'List practice problems and local reviewed status.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (input: unknown) => {
          validate(input);
          return {
            coding: coding.map((p) => ({
              id: p.id,
              title: p.title,
              topic: p.topic,
              done: !!latest.current.drafts[p.id]?.done,
            })),
            design: designs.map((p) => ({
              id: p.id,
              title: p.title,
              topic: p.topic,
              done: !!latest.current.drafts[p.id]?.done,
            })),
          };
        },
      },
      {
        name: 'get_current_practice',
        description: 'Read the selected practice problem and saved draft.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input: unknown) => {
          validate(input);
          return {
            track: latest.current.track,
            id: latest.current.id,
            stage: latest.current.stage,
            draft: latest.current.drafts[latest.current.id] || {},
          };
        },
      },
    ])
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    return () => lifecycle.abort();
  }, []);
  const isCode = track === 'coding',
    list = isCode ? coding : designs,
    filtered = filterProblems<
      (typeof coding)[number] | (typeof designs)[number]
    >(list, drafts, query, topic, status).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  function navigate(next: string, nextTrack = track) {
    setId(next);
    setTrack(nextTrack);
    setStage('base');
    setLibrary(false);
  }
  function openSettings() {
    setKeyInput(apiKey);
    setSettings(true);
  }
  function exportWork() {
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), drafts, submissions },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'interview-lab-progress.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main
      className={`lab ${library ? 'library-view' : 'practice-view'}`}
    >
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            setLibrary(true);
          }}
        >
          <Code2 size={20} />
          <b>
            interview<span>lab</span>
          </b>
        </button>
        <span className="header-caption">Backend practice</span>
        <div className="toolbar-spacer" />
        <Button variant="ghost" onClick={exportWork}>
          <Download /> Export work
        </Button>
        <Button variant="ghost" onClick={openSettings}>
          <Settings2 /> AI settings
        </Button>
        <Button
          variant="ghost"
          aria-label={dark ? 'Use light theme' : 'Use dark theme'}
          onClick={() => setDark(!dark)}
        >
          {dark ? <Sun /> : <Moon />}
        </Button>
      </header>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="ai-settings">
          <DialogTitle>Connect your AI coach</DialogTitle>
          <DialogDescription>
            DeepSeek V4.1 Flash · reviews, hints, and code suggestions.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const key = keyInput.trim();
              setApiKey(key);
              try {
                localStorage.setItem(AI_KEY, key);
              } catch {
                setNotice(
                  'Your key will work for this visit only; browser storage is unavailable.',
                );
              }
              setKeyInput('');
              setSettings(false);
            }}
          >
            <label htmlFor="deepseek-key">DeepSeek API key</label>
            <Input
              id="deepseek-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste your API key"
            />
            <p className="muted">
              Saved in this browser across restarts, separately from your
              drafts. Never included in exports. Requests send your selected
              work to DeepSeek.
            </p>
            <div className="settings-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setApiKey('');
                  setKeyInput('');
                  try {
                    localStorage.removeItem(AI_KEY);
                  } catch {
                    setNotice(
                      'Could not remove the saved key. Clear this site’s browser data to remove it.',
                    );
                  }
                  setSettings(false);
                }}
              >
                Forget key
              </Button>
              <Button type="submit" disabled={!keyInput.trim()}>
                Save API key
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {notice && (
        <output className="global-notice">
          {notice}
          <Button
            variant="ghost"
            aria-label="Dismiss notice"
            onClick={() => setNotice('')}
          >
            ×
          </Button>
        </output>
      )}
      {library ? (
        <div className="library-container">
          <div className="tab-switch track-tabs">
            {(['coding', 'design'] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-slot="tabs-trigger"
                aria-pressed={track === value}
                onClick={() => {
                  setTrack(value);
                  setId(value === 'coding' ? coding[0].id : designs[0].id);
                  setQuery('');
                  setTopic('All topics');
                  setStatus('All statuses');
                }}
              >
                {value === 'coding' ? <Code2 /> : <Network />}{' '}
                {value === 'coding' ? 'Coding' : 'Design'} ·{' '}
                {value === 'coding' ? coding.length : designs.length}
              </button>
            ))}
          </div>
          <section className="problem-library">
            <div className="eyebrow">YOUR NEXT CHAPTER</div>
            <h1>Your practice library.</h1>
            <p className="library-intro">
              Coding problems, system design, and follow-up labs for your next
              interview.
            </p>
            <div className="library-stats">
              <div>
                <span>Reviewed</span>
                <strong>
                  {
                    list.filter((p) => statusOf(drafts[p.id]) === 'Reviewed')
                      .length
                  }
                  <small> / {list.length}</small>
                </strong>
                <div className="stat-line" />
              </div>
              <div>
                <span>In progress</span>
                <strong>
                  {
                    list.filter((p) => statusOf(drafts[p.id]) === 'In progress')
                      .length
                  }
                </strong>
                <small>Pick up where you left off</small>
              </div>
              <div>
                <span>{isCode ? 'Follow-up labs' : 'Failure scenarios'}</span>
                <strong>{isCode ? coding.length : failureScenarios}</strong>
                <small>
                  {isCode
                    ? 'Go deeper with every problem'
                    : 'Pressure-test your architecture'}
                </small>
              </div>
            </div>
            <div className="library-section-heading">
              <div>
                <h2>{isCode ? 'Backend coding path' : 'System design path'}</h2>
                <p className="muted">
                  {isCode
                    ? 'Practical components, core patterns, and the edge cases that matter.'
                    : 'From requirements to tradeoffs. Practice the whole conversation.'}
                </p>
              </div>
              <span className="count-pill">{filtered.length} problems</span>
            </div>
            <div className="library-filters">
              <div className="library-search">
                <Search size={17} />
                <Input
                  aria-label="Search library"
                  placeholder="Search problems…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                aria-label="Filter by topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                <option>All topics</option>
                {[...new Set(list.map((p) => p.topic))].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {['All statuses', 'Not started', 'In progress', 'Reviewed'].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </div>
            <div className="problem-table-wrap">
              <table className="problem-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Problem</th>
                    <th>Topic</th>
                    <th>Target</th>
                    <th aria-label="Open problem" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span
                          className={`status-icon ${statusOf(drafts[item.id]).toLowerCase().replace(' ', '-')}`}
                          title={statusOf(drafts[item.id])}
                        >
                          {drafts[item.id]?.done ? (
                            <CheckCircle2 size={18} />
                          ) : (
                            <Circle size={18} />
                          )}
                          <span className="sr-only">
                            {statusOf(drafts[item.id])}
                          </span>
                        </span>
                      </td>
                      <td>
                        <div className="problem-title-row">
                          <button
                            className="problem-link"
                            disabled={!loaded}
                            onClick={() => navigate(item.id)}
                          >
                            {item.title}
                          </button>
                          <DifficultyBadge difficulty={item.difficulty} />
                        </div>
                        <small>
                          {'mode' in item
                            ? String(item.mode)
                            : 'Architecture & tradeoffs'}
                        </small>
                      </td>
                      <td>
                        <span className="topic-pill">{item.topic}</span>
                      </td>
                      <td>{item.minutes} min</td>
                      <td>
                        <Button
                          variant="ghost"
                          aria-label={`Open ${item.title}`}
                          disabled={!loaded}
                          onClick={() => navigate(item.id)}
                        >
                          <ArrowRight size={16} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className="library-empty">
                <Search />
                <h2>No problems match those filters.</h2>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('');
                    setTopic('All topics');
                    setStatus('All statuses');
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
            <p className="library-footnote">
              Original practice problems · Progress saved on this device · No
              account needed
            </p>
          </section>
        </div>
      ) : (
        <PracticeWorkspace
          key={id}
          id={id}
          track={track}
          stage={stage}
          onStage={setStage}
          mock={mock}
          setMock={setMock}
          assist={assist}
          setAssist={setAssist}
          draft={drafts[id] || {}}
          loaded={loaded}
          apiKey={apiKey}
          dark={dark}
          submissions={submissions}
          onPatch={onPatch}
          onSubmit={onSubmit}
          seconds={clock.seconds}
          running={clock.running}
          onClockToggle={toggleClock}
          onClockReset={resetClock}
          stdin={stdinState.id === id ? stdinState.text : ''}
          onStdin={onStdin}
          onSettings={openSettings}
          onNavigate={(next) => navigate(next)}
          onLibrary={() => setLibrary(true)}
        />
      )}
    </main>
  );
}
