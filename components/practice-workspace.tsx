'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { PythonCode } from '@/components/python-code';
import { AICoach, type CoachHandle } from '@/components/ai-coach';
import { FormattedText, InlineText } from '@/components/formatted-text';
import { DifficultyBadge } from '@/components/difficulty-badge';
import {
  DesignFlow,
  DesignProbes,
  DesignRubric,
  DesignScorecard,
  DesignSolution,
} from '@/components/design-interview';
import { DESIGN_SECTIONS, sectionById } from '@/lib/design';
import { acceptEdit, type Proposal } from '@/lib/review';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { verdict, type RunResult, type Submission } from '@/lib/submissions';
import type { Draft } from '@/lib/practice';
import coding from '@/app/data/coding.json';
import followups from '@/app/data/followups.json';
import designs from '@/app/data/design.json';
import designAnswers from '@/app/data/design-answers.json';
import contentData from '@/app/data/problem-content.json';
import {
  BookOpen,
  FileText,
  History,
  Code2,
  Bot,
  Lightbulb,
  Wand2,
  Play,
  Square,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Gauge,
  RotateCcw,
  Check,
  X,
  Copy,
} from 'lucide-react';

type ProblemContent = {
  overview: string;
  task: string;
  requirements: string[];
  examples: { code: string; output: string; explanation: string }[];
  approach: string;
  interface?: string[];
  note?: string;
};
const contents: Record<string, ProblemContent> = contentData;
type Props = {
  stage: string;
  onStage: (s: 'base' | 'followup') => void;
  mock: boolean;
  setMock: (v: boolean) => void;
  /** Editor assistance: completions and auto-closing brackets. */
  assist: boolean;
  setAssist: (v: boolean) => void;
  id: string;
  track: string;
  draft: Draft;
  loaded: boolean;
  apiKey: string;
  dark: boolean;
  submissions: Submission[];
  onPatch: (p: Partial<Draft>) => void;
  onSubmit: (s: Submission) => void;
  onSettings: () => void;
  onNavigate: (id: string) => void;
  onLibrary: () => void;
  seconds: number;
  running: boolean;
  onClockToggle: () => void;
  onClockReset: () => void;
  stdin: string;
  onStdin: (v: string) => void;
};
export function PracticeWorkspace(props: Props) {
  return <PracticeSession key={props.id + props.stage} {...props} />;
}
function PracticeSession({
  id,
  track,
  draft,
  loaded,
  apiKey,
  dark,
  submissions,
  onPatch,
  onSubmit,
  onSettings,
  onNavigate,
  onLibrary,
  stage,
  onStage,
  mock,
  setMock,
  assist,
  setAssist,
  seconds,
  running,
  onClockToggle,
  onClockReset,
  stdin,
  onStdin,
}: Props) {
  const isCode = track === 'coding',
    base = coding.find((p) => p.id === id) || coding[0],
    extension = followups.find((p) => p.id === base.id)!,
    p = stage === 'base' ? base : { ...base, ...extension },
    d = designs.find((p) => p.id === id) || designs[0],
    current = isCode ? p : d,
    content = contents[id + (stage === 'followup' ? ':followup' : '')],
    designSolution = designAnswers.find((p) => p.id === d.id)!;
  const code =
      (stage === 'base' ? draft.code : draft.followupCode) ?? p.starter,
    notes = (stage === 'base' ? draft.notes : draft.followupNotes) || '';
  const [resetOpen, setResetOpen] = useState(false),
    [tab, setTab] = useState('question'),
    [coachOpen, setCoachOpen] = useState(false),
    [consoleOpen, setConsoleOpen] = useState(false),
    [consoleTab, setConsoleTab] = useState('tests'),
    [result, setResult] = useState<RunResult | null>(null),
    [runCode, setRunCode] = useState(''),
    [scope, setScope] = useState('all'),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(''),
    [selectedCase, setSelectedCase] = useState(0),
    [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(
      null,
    ),
    [submissionFilter, setSubmissionFilter] = useState('All'),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [undo, setUndo] = useState<{ before: string; after: string } | null>(null),
    [notice, setNotice] = useState(''),
    [narrow, setNarrow] = useState(false);
  const worker = useRef<Worker | null>(null),
    watchdog = useRef<ReturnType<typeof setTimeout> | null>(null),
    coach = useRef<CoachHandle | null>(null),
    coachToggle = useRef<HTMLButtonElement | null>(null);
  const history = submissions.filter(
      (s) => s.problemId === id && s.stage === stage,
    ),
    shown = history.filter(
      (s) =>
        submissionFilter === 'All' || verdict(s.result) === submissionFilter,
    ),
    list = isCode ? coding : designs,
    index = list.findIndex((x) => x.id === id);
  const patchCode = (value: string) =>
    onPatch(stage === 'base' ? { code: value } : { followupCode: value });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 850px)');
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(
    () => () => {
      worker.current?.terminate();
      if (watchdog.current) clearTimeout(watchdog.current);
    },
    [],
  );
  // Clear pending edits whenever external mock mode changes.
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- Mock mode must clear an external pending proposal.
    if (mock) setProposal(null);
  }, [mock]);
  function stop(message = 'Stopped. Your code is unchanged.') {
    worker.current?.terminate();
    worker.current = null;
    if (watchdog.current) clearTimeout(watchdog.current);
    setBusy(false);
    setPhase(message);
  }
  function run(submit: boolean) {
    if (!loaded || busy) return;
    setProposal(null);
    stop('');
    setBusy(true);
    setResult(null);
    setRunCode(code);
    setScope(submit ? 'all' : 'quick');
    setConsoleOpen(true);
    setConsoleTab('output');
    setSelectedCase(0);
    setPhase('Loading Python…');
    const source = code;
    const w = new Worker('/python-worker.js');
    worker.current = w;
    let started = 0;
    const finish = (r: RunResult) => {
      if (worker.current !== w) return;
      stop('Finished');
      const complete = {
        ...r,
        durationMs: started
          ? Math.round(performance.now() - started)
          : undefined,
      };
      setResult(complete);
      if (submit) {
        const item: Submission = {
          id:
            globalThis.crypto?.randomUUID?.() ??
            `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
          problemId: id,
          stage,
          code: source,
          at: new Date().toISOString(),
          result: complete,
        };
        onSubmit(item);
        setSelectedSubmission(item);
        setTab('submissions');
      }
    };
    watchdog.current = setTimeout(
      () =>
        finish({
          output: '',
          error: 'Python could not load in time. Try again.',
          results: [],
        }),
      90000,
    );
    w.onerror = (e) =>
      finish({
        output: '',
        error: e.message || 'Python could not start.',
        results: [],
      });
    w.onmessage = ({ data }) => {
      if (worker.current !== w) return;
      if (data.type === 'started') {
        if (watchdog.current) clearTimeout(watchdog.current);
        started = performance.now();
        setPhase('Running…');
        watchdog.current = setTimeout(
          () =>
            finish({
              output: '',
              error:
                'Execution exceeded 10 seconds. Check for an infinite loop or an inefficient approach.',
              results: [],
              timeout: true,
            }),
          10000,
        );
      } else if (data.type === 'result') finish(data);
    };
    w.postMessage({
      code: source,
      stdin,
      tests: submit ? p.tests : p.tests.slice(0, 2),
    });
  }
  function scratch() {
    if (!loaded || busy) return;
    stop('');
    setBusy(true);
    setRunCode(code);
    setResult(null);
    setScope('scratch');
    setConsoleOpen(true);
    setConsoleTab('output');
    setPhase('Loading Python…');
    const w = new Worker('/python-worker.js');
    worker.current = w;
    const finish = (r: RunResult) => {
      if (worker.current !== w) return;
      stop('Finished');
      setResult(r);
    };
    watchdog.current = setTimeout(
      () =>
        finish({
          output: '',
          error: 'Python could not load in time.',
          results: [],
        }),
      90000,
    );
    w.onmessage = ({ data }) => {
      if (worker.current !== w) return;
      if (data.type === 'started') {
        if (watchdog.current) clearTimeout(watchdog.current);
        setPhase('Running…');
        watchdog.current = setTimeout(
          () =>
            finish({
              output: '',
              error: 'Execution exceeded 10 seconds.',
              results: [],
              timeout: true,
            }),
          10000,
        );
      } else if (data.type === 'result') finish(data);
    };
    w.onerror = (e) => finish({ output: '', error: e.message, results: [] });
    w.postMessage({ code, stdin, tests: [] });
  }
  /** The candidate's design work, flattened for the ad-hoc coach chat. */
  function designContext() {
    const excerpt = (text: string, limit: number) =>
      text.length <= limit
        ? text
        : `${text.slice(0, limit)}\n[Text shortened for the coach; the full answer is saved in your draft.]`;
    const written = DESIGN_SECTIONS.map((section) => {
      const state = draft.design?.sections?.[section.id];
      if (!state?.answer?.trim()) return '';
      const conversation = state.turns
        .map(
          (turn, i) =>
            `Follow-up ${i + 1}: ${excerpt(turn.question, 300)}\nCandidate: ${excerpt(turn.answer, 1000)}`,
        )
        .join('\n');
      const feedback = state.grade?.gaps.length
        ? `Latest review gaps: ${state.grade.gaps.join('; ')}`
        : '';
      return `### ${section.title}\n${excerpt(state.answer, 2500)}\n${conversation}\n${feedback}${state.pending ? `\nPending interviewer question: ${state.pending}` : ''}`;
    }).filter(Boolean);
    return `SYSTEM DESIGN: ${d.title}\n${d.statement}\nASSUMPTIONS:\n${d.assumptions.join('\n')}\nRUBRIC:\n${d.rubric
      .map(
        (r) =>
          `- ${sectionById(r.section)?.title ?? r.section}: ${r.expects.join('; ')}`,
      )
      .join(
        '\n',
      )}\nCANDIDATE ANSWERS:\n${written.join('\n\n') || '(none written yet)'}`;
  }
  function context(source = code, r = result, matches = source === runCode) {
    return isCode
      ? `PROBLEM: ${p.title}\nCONTRACT: ${p.statement}\nCANDIDATE CODE:\n${source}\nNOTES:\n${notes}\nLAST RUN (${matches ? 'matches this code' : 'may be stale; do not assume this output is from this code'}):\n${JSON.stringify(r)}\nTests are supplied evidence, not proof of correctness.`
      : designContext();
  }
  function ask(mode: string, submission?: Submission) {
    setCoachOpen(true);
    if (submission)
      coach.current?.ask(mode, undefined, {
        context: `${context(submission.code, submission.result, true)}\nThis is the saved submission and its matching test result.`,
        code: submission.code,
      });
    else coach.current?.ask(mode);
  }
  // Accept/Reject go into the editor's extensions, which are rebuilt whenever
  // the callback identity changes. Keep both stable so the 250 ms timer tick
  // cannot tear down the inline edit buttons or steal focus from them.
  const accept = useStableCallback((index: number) => {
    if (!proposal) return;
    try {
      const changed = acceptEdit(code, proposal, index);
      setUndo({ before: code, after: changed.code });
      patchCode(changed.code);
      setProposal(changed.proposal);
      setNotice('Edit accepted. Run the tests to verify it.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  });
  const reject = useStableCallback((index: number) => {
    if (!proposal) return;
    const edits = proposal.edits.filter((_, i) => i !== index);
    setProposal(edits.length ? { ...proposal, edits } : null);
  });
  const passed = result?.results.filter((t) => t.passed).length || 0,
    failed =
      result &&
      (!!result.error ||
        result.timeout ||
        result.results.some((t) => !t.passed));
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied.');
    } catch {
      setNotice('Clipboard unavailable. Select the code and copy it manually.');
    }
  }
  const left = (
    <section className="question-pane">
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="workspace-tabs">
          <TabsTrigger value="question">
            <FileText /> Question
          </TabsTrigger>
          <TabsTrigger value="solution">
            <BookOpen /> Solution
          </TabsTrigger>
          {isCode ? (
            <TabsTrigger value="submissions">
              <History /> Submissions
            </TabsTrigger>
          ) : (
            <TabsTrigger value="scorecard">
              <Gauge /> Report
            </TabsTrigger>
          )}
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="question" className="question-scroll">
          <>
            <div className="question-title">
              <h1>{current.title}</h1>
              {(stage === 'base' ? draft.done : draft.followupDone) && (
                <Check className="success" size={20} />
              )}
            </div>
            <div className="question-badges">
              <DifficultyBadge difficulty={current.difficulty} />
              <span className="practice-kind">
                {isCode ? p.mode : 'System design'}
              </span>
              <span>{current.topic}</span>
              <span>{current.minutes} min</span>
              {isCode && (
                <button
                  onClick={() =>
                    document
                      .getElementById('static-hints')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                  }
                >
                  Hints
                </button>
              )}
            </div>
            {isCode ? (
              <>
                <p className="problem-overview">{content.overview}</p>
                <p>
                  <InlineText text={content.task} />
                </p>
                <div className="contract-note">
                  <b>Important</b>
                  <span>
                    <InlineText
                      text={
                        content.note ||
                        (stage === 'base'
                          ? 'Match the interface and return values exactly.'
                          : 'This is a separate contract from the base problem. Its draft and submissions are saved independently.')
                      }
                    />
                  </span>
                </div>
                {content.examples.map((example, i) => (
                  <section className="problem-example" key={i}>
                    <h3>Example {i + 1}</h3>
                    <div className="example-box">
                      <b>Input</b>
                      <pre>{example.code}</pre>
                      <b>Output</b>
                      <pre>{example.output}</pre>
                    </div>
                    <p>
                      <strong>Explanation: </strong>
                      {example.explanation}
                    </p>
                  </section>
                ))}
                <h2>Requirements & constraints</h2>
                {content.interface && (
                  <details className="interface-list">
                    <summary>Required interface</summary>
                    {content.interface.map((signature) => (
                      <pre key={signature}>{signature}</pre>
                    ))}
                  </details>
                )}
                <ul className="requirements">
                  {content.requirements.map((rule, i) => (
                    <li key={i}>
                      <InlineText text={rule} />
                    </li>
                  ))}
                </ul>
                <details>
                  <summary>Topics</summary>
                  <p>{current.topic}</p>
                </details>
                {!mock && (
                  <>
                    <details>
                      <summary>Recommended time & space complexity</summary>
                      <p>{p.complexity}</p>
                    </details>
                    <div id="static-hints">
                      {p.hints.map((h, i) => (
                        <details key={i}>
                          <summary>Hint {i + 1}</summary>
                          <FormattedText text={h} />
                        </details>
                      ))}
                    </div>
                  </>
                )}
                <div className="coding-followup-questions">
                  <h2>Follow-up questions</h2>
                  <p className="muted">
                    Practise these next. Each badge rates that question; the
                    worked answers are in the Solution tab.
                  </p>
                  <ol>
                    {extension.answers.map((item) => (
                      <li key={item.question}>
                        <div className="followup-question-row">
                          <span>
                            <InlineText text={item.question} />
                          </span>
                          <DifficultyBadge difficulty={item.difficulty} />
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            ) : (
              <>
                <p className="problem-overview">{d.statement}</p>
                <div className="contract-note">
                  <b>How this works</b>
                  <span>
                    A 60 minute interview in six sections. Write your answer for
                    one section, submit it, and the interviewer grades it
                    against this scenario&apos;s rubric and asks a follow-up if
                    something is unproven. Your report keeps the rubric score
                    and the amount of help you needed as separate numbers.
                  </span>
                </div>
                <h2>Requirements & scale</h2>
                <ul className="requirements">
                  {d.assumptions.map((a) => (
                    <li key={a}>
                      <InlineText text={a} />
                    </li>
                  ))}
                </ul>
                <DesignRubric scenario={d} />
                <DesignProbes scenario={d} />
                <h2>Failure scenarios</h2>
                <p className="muted">
                  These are raised by the interviewer at the section shown, not
                  handed to you as a list to answer at the end.
                </p>
                {d.failures.map((f) => (
                  <details key={f.scenario}>
                    <summary>
                      {f.scenario}
                      <small>
                        {' '}
                        · raised in {sectionById(f.section)?.title}
                      </small>
                    </summary>
                    {mock ? (
                      <p>
                        Explain what should happen, then review after the mock.
                      </p>
                    ) : (
                      <FormattedText
                        text={
                          designSolution.failures.find(
                            (x) => x.scenario === f.scenario,
                          )?.expected || ''
                        }
                      />
                    )}
                  </details>
                ))}
              </>
            )}
          </>
        </TabsContent>
        <TabsContent value="solution" className="question-scroll">
          {mock ? (
            <div className="empty-pane">
              <BookOpen />
              <h2>Solution hidden during your mock</h2>
              <p>Turn off mock mode when you are ready to review.</p>
            </div>
          ) : isCode ? (
            <>
              <h1>Solution & walkthrough</h1>
              <h2>Approach</h2>
              <FormattedText text={content.approach} />
              <h2>Trace an example</h2>
              <p>{content.examples[0].explanation}</p>
              <div className="example-box">
                <pre>{content.examples[0].code}</pre>
                <b>Result</b>
                <pre>{content.examples[0].output}</pre>
              </div>
              <div className="section-heading">
                <h2>Python implementation</h2>
                <Button variant="ghost" onClick={() => copy(p.solution)}>
                  <Copy /> Copy
                </Button>
              </div>
              <PythonCode
                value={p.solution}
                readOnly
                dark={dark}
                label="Reference solution"
              />
              <h2>Time & space complexity</h2>
              <p>{p.complexity}</p>
              <h2>Follow-up discussion</h2>
              <p className="muted">
                The questions the interviewer will push on, with the answer to
                each and the checks worth verifying. Open by default, because a
                question with its answer hidden reads as a question with no
                answer.
              </p>
              {extension.answers.map((item, i) => (
                <div className="followup-block" key={item.question}>
                  <p className="followup-question followup-question-row">
                    <span>
                      {i + 1}. {item.question}
                    </span>
                    <DifficultyBadge difficulty={item.difficulty} />
                  </p>
                  <FormattedText text={item.answer} />
                  {item.checks.length > 0 && (
                    <>
                      <h3>Validation checks</h3>
                      <ul>
                        {item.checks.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ))}
            </>
          ) : (
            <DesignSolution scenario={d} reference={designSolution} />
          )}
        </TabsContent>
        <TabsContent value="scorecard" className="question-scroll">
          {isCode ? null : <DesignScorecard draft={draft} />}
        </TabsContent>
        <TabsContent value="notes" className="question-scroll">
          <>
            <h1>Your notes</h1>
            <p className="muted">
              Capture assumptions, invariants, complexity, and what you would
              change next time.
            </p>
            <textarea
              aria-label="Reasoning, complexity & self-review"
              className="notes-editor"
              value={notes}
              onChange={(e) =>
                onPatch(
                  stage === 'base'
                    ? { notes: e.target.value }
                    : { followupNotes: e.target.value },
                )
              }
              disabled={!loaded}
            />
            <Button variant="outline" onClick={() => copy(context())}>
              <Copy /> Copy review context
            </Button>
          </>
        </TabsContent>
        <TabsContent value="submissions" className="question-scroll">
          {isCode && (
            <>
              {selectedSubmission ? (
                <>
                  <Button
                    className="back-submissions"
                    variant="ghost"
                    onClick={() => setSelectedSubmission(null)}
                  >
                    <ChevronLeft /> All submissions
                  </Button>
                  <div className="submission-verdict">
                    <h2
                      className={
                        verdict(selectedSubmission.result) === 'Accepted'
                          ? 'success'
                          : 'error'
                      }
                    >
                      {verdict(selectedSubmission.result)}
                    </h2>
                    <span>
                      {
                        selectedSubmission.result.results.filter(
                          (t) => t.passed,
                        ).length
                      }{' '}
                      / {p.tests.length} test groups
                    </span>
                  </div>
                  <p className="muted">
                    Submitted {new Date(selectedSubmission.at).toLocaleString()}
                  </p>
                  <div className="submission-metrics">
                    <div>
                      <Clock3 size={16} />
                      <span>Execution time</span>
                      <strong>
                        {selectedSubmission.result.durationMs === undefined
                          ? 'Unavailable'
                          : `${selectedSubmission.result.durationMs} ms`}
                      </strong>
                      <small>Local Python run · includes all test groups</small>
                    </div>
                    <div>
                      <Check size={16} />
                      <span>Test groups passed</span>
                      <strong>
                        {
                          selectedSubmission.result.results.filter(
                            (t) => t.passed,
                          ).length
                        }{' '}
                        / {p.tests.length}
                      </strong>
                      <small>Passing tests is not a proof of correctness</small>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={mock || busy}
                    onClick={() =>
                      ask(
                        verdict(selectedSubmission.result) === 'Accepted'
                          ? 'complexity'
                          : 'debug',
                        selectedSubmission,
                      )
                    }
                  >
                    <Lightbulb />
                    {verdict(selectedSubmission.result) === 'Accepted'
                      ? 'Analyze Complexity'
                      : 'Suggest Fix'}
                  </Button>
                  {selectedSubmission.result.error && (
                    <pre className="failure-output">
                      {selectedSubmission.result.error}
                    </pre>
                  )}
                  {selectedSubmission.result.results
                    .filter((t) => !t.passed)
                    .map((t) => (
                      <details key={t.name}>
                        <summary>{t.name}</summary>
                        <pre className="failure-output">{t.error}</pre>
                      </details>
                    ))}
                  <div className="section-heading">
                    <h2>Submitted code · Python</h2>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setUndo({
                          before: code,
                          after: selectedSubmission.code,
                        });
                        patchCode(selectedSubmission.code);
                        setProposal(null);
                        setNotice(
                          'Submission loaded. Undo restores your previous draft.',
                        );
                      }}
                    >
                      Use this code
                    </Button>
                  </div>
                  <PythonCode
                    value={selectedSubmission.code}
                    readOnly
                    dark={dark}
                    label="Submitted code"
                  />
                </>
              ) : (
                <>
                  <h1>Submissions</h1>
                  <p className="muted">
                    Saved attempts for this{' '}
                    {stage === 'base' ? 'base problem' : 'follow-up lab'}.
                    Submit runs all {p.tests.length} test groups.
                  </p>
                  <div className="submission-filters">
                    {[
                      'All',
                      'Accepted',
                      'Wrong Answer',
                      'Runtime Error',
                      'Time Limit Exceeded',
                    ].map((v) => (
                      <button
                        key={v}
                        aria-pressed={submissionFilter === v}
                        onClick={() => setSubmissionFilter(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  {!history.length ? (
                    <div className="empty-pane">
                      <History />
                      <h2>No submissions yet</h2>
                      <p>
                        Run a quick check, then Submit to save a full test run
                        here.
                      </p>
                    </div>
                  ) : !shown.length ? (
                    <div className="empty-pane">
                      <History />
                      <h2>No {submissionFilter.toLowerCase()} submissions</h2>
                      <p>
                        This stage has {history.length}{' '}
                        {history.length === 1
                          ? 'saved attempt'
                          : 'saved attempts'}
                        , none with that result.
                      </p>
                      <Button
                        variant="ghost"
                        onClick={() => setSubmissionFilter('All')}
                      >
                        Show all submissions
                      </Button>
                    </div>
                  ) : (
                    <table className="submissions-table">
                      <thead>
                        <tr>
                          <th>Submission</th>
                          <th>Code</th>
                          <th>Analysis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <button
                                className={
                                  verdict(s.result) === 'Accepted'
                                    ? 'success'
                                    : 'error'
                                }
                                onClick={() => setSelectedSubmission(s)}
                              >
                                {verdict(s.result)}
                              </button>
                              <small>{new Date(s.at).toLocaleString()}</small>
                            </td>
                            <td>
                              <button onClick={() => setSelectedSubmission(s)}>
                                View
                              </button>
                            </td>
                            <td>
                              <button
                                disabled={mock || busy}
                                onClick={() =>
                                  ask(
                                    verdict(s.result) === 'Accepted'
                                      ? 'complexity'
                                      : 'debug',
                                    s,
                                  )
                                }
                              >
                                {verdict(s.result) === 'Accepted'
                                  ? 'Analyze Complexity'
                                  : 'Suggest Fix'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
  const editor = (
    <section className="coding-pane">
      <div className="pane-toolbar">
        <Code2 size={15} />
        <span>{isCode ? 'Python 3' : 'Design interview'}</span>
        {isCode && (
          <button
            type="button"
            className={`assist-toggle ${assist ? 'on' : 'off'}`}
            aria-pressed={assist}
            title={
              assist
                ? 'Code completions are on. Click to type without suggestions.'
                : 'Code completions are off. Click to turn them on.'
            }
            onClick={() => setAssist(!assist)}
          >
            <Wand2 size={13} />
            Autocomplete
            <span className="assist-state">{assist ? 'On' : 'Off'}</span>
          </button>
        )}
        <span className="autosave">● Local draft</span>
        <div className="toolbar-spacer" />
        <Button
          variant="outline"
          aria-label="AI coach"
          ref={coachToggle}
          aria-expanded={coachOpen}
          aria-controls="lab-coach-dock"
          onClick={() => setCoachOpen(!coachOpen)}
        >
          <Bot /> Lab Coach
        </Button>
        {isCode && (
          <Button
            variant="outline"
            disabled={mock || busy}
            onClick={() => ask('hint')}
          >
            <Lightbulb /> Hint
          </Button>
        )}
      </div>
      <div className="editor-filebar">
        <span>{isCode ? 'solution.py' : 'local draft'}</span>
        <small>
          {isCode
            ? stage === 'base'
              ? 'Base problem'
              : 'Follow-up lab'
            : `${current.minutes} min interview`}
        </small>
        <div className="toolbar-spacer" />
        {isCode && (
          <Button
            variant="ghost"
            disabled={!loaded || busy}
            onClick={() => setResetOpen(true)}
          >
            <RotateCcw /> Reset code
          </Button>
        )}
        {undo && (
          <Button
            variant="ghost"
            disabled={code !== undo.after}
            onClick={() => {
              patchCode(undo.before);
              setUndo(null);
              setProposal(null);
              setNotice('Previous code restored.');
            }}
          >
            <RotateCcw /> Undo change
          </Button>
        )}
      </div>
      {notice && (
        <output className="workspace-notice">
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </output>
      )}
      {proposal && (
        <div
          className={`proposal-banner ${proposal.base !== code ? 'stale' : ''}`}
        >
          <span>
            {proposal.base === code
              ? `${proposal.edits.length} proposed edits · red removes, green adds`
              : 'Your code changed. Request a fresh suggestion before accepting edits.'}
          </span>
          <Button variant="ghost" onClick={() => setProposal(null)}>
            Reject all
          </Button>
        </div>
      )}
      <div className="editor-surface">
        {isCode ? (
          <PythonCode
            value={code}
            disabled={!loaded}
            onChange={patchCode}
            onRun={() => run(false)}
            dark={dark}
            assist={assist}
            proposal={mock ? null : proposal}
            onAccept={accept}
            onReject={reject}
          />
        ) : (
          <DesignFlow
            scenario={d}
            reference={designSolution}
            draft={draft}
            mock={mock}
            apiKey={apiKey}
            onSettings={onSettings}
            onPatch={onPatch}
          />
        )}
      </div>
      {isCode && consoleOpen && (
        <section
          className="test-console"
          id="lab-console"
          aria-label="Python results"
        >
          <Tabs
            value={consoleTab}
            onValueChange={(v) => setConsoleTab(String(v))}
          >
            <TabsList className="workspace-tabs">
              <TabsTrigger value="tests">Test cases</TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
            </TabsList>
            <TabsContent value="tests" className="console-scroll">
              <>
                <p className="muted">
                  Run checks the first 2 groups. Submit checks all{' '}
                  {p.tests.length}. Each group starts with a fresh namespace.
                </p>
                {p.tests.map((t, i) => (
                  <details key={t.name}>
                    <summary>
                      Case {i + 1} · {t.name}
                    </summary>
                    <PythonCode
                      value={t.code}
                      readOnly
                      dark={dark}
                      label={`Test case: ${t.name}`}
                    />
                  </details>
                ))}
                <details>
                  <summary>Scratch code & standard input</summary>
                  <textarea
                    aria-label="Standard input"
                    value={stdin}
                    onChange={(e) => onStdin(e.target.value)}
                  />
                  <Button variant="outline" disabled={busy} onClick={scratch}>
                    Run code
                  </Button>
                </details>
              </>
            </TabsContent>
            <TabsContent value="output" className="console-scroll">
              <div className="output-status">
                <strong className={failed ? 'error' : result ? 'success' : ''}>
                  {busy
                    ? phase
                    : result
                      ? result.results.length || result.error
                        ? scope === 'quick' && verdict(result) === 'Accepted'
                          ? 'Quick check passed'
                          : verdict(result)
                        : 'Finished'
                      : phase || 'Run your code to see results'}
                </strong>
                {failed && (
                  <Button
                    variant="outline"
                    disabled={mock || busy}
                    onClick={() => ask('debug')}
                  >
                    <Lightbulb /> Suggest Fix
                  </Button>
                )}
                <span>
                  {result?.results.length
                    ? scope === 'quick'
                      ? `Quick run: ${passed} of ${p.tests.length} groups passed`
                      : `Passed test groups: ${passed} / ${result.results.length}`
                    : ''}
                </span>
              </div>
              {result && code !== runCode && (
                <p className="stale-result">
                  Code changed since this run. Run again to check your latest
                  work.
                </p>
              )}
              {!!result?.results.length && (
                <div className="case-tabs">
                  {result.results.map((t, i) => (
                    <button
                      aria-pressed={selectedCase === i}
                      key={t.name}
                      onClick={() => setSelectedCase(i)}
                    >
                      {t.passed ? (
                        <Check size={14} className="success" />
                      ) : (
                        <X size={14} className="error" />
                      )}
                      Case {i + 1}
                    </button>
                  ))}
                </div>
              )}
              {result?.error && (
                <pre className="failure-output">{result.error}</pre>
              )}
              {result?.results[selectedCase] && (
                <>
                  <h3>{result.results[selectedCase].name}</h3>
                  {result.results[selectedCase].passed ? (
                    <p className="success">Passed</p>
                  ) : result.results[selectedCase].error ? (
                    <pre className="failure-output">
                      {result.results[selectedCase].error}
                    </pre>
                  ) : (
                    <p className="error">
                      Failed without a reported error. Check the test code and
                      the test output above.
                    </p>
                  )}
                  <details>
                    <summary>Test code</summary>
                    <pre>{p.tests[selectedCase]?.code}</pre>
                  </details>
                </>
              )}
              {result?.output && (
                <>
                  <h3>Standard output</h3>
                  <pre>{result.output}</pre>
                </>
              )}
            </TabsContent>
          </Tabs>
        </section>
      )}
      {/* Run, Submit and the Python console have no meaning for a design
          interview, so the bar is code-only. Grading lives in the flow. */}
      {isCode && (
        <div className="run-toolbar">
          <Button
            variant="ghost"
            aria-expanded={consoleOpen}
            aria-controls="lab-console"
            onClick={() => setConsoleOpen(!consoleOpen)}
          >
            Console {consoleOpen ? <ChevronDown /> : <ChevronUp />}
          </Button>
          <span className="run-shortcut">⌘ / Ctrl + Enter to run</span>
          <div className="toolbar-spacer" />
          {busy ? (
            <Button variant="outline" onClick={() => stop()}>
              <Square /> Stop
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={!loaded}
                onClick={() => run(false)}
              >
                <Play /> Run
              </Button>
              <Button
                className="submit-button"
                disabled={!loaded}
                onClick={() => run(true)}
              >
                Submit
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
  return (
    <div className="practice-shell">
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Reset code?</AlertDialogTitle>
          <AlertDialogDescription>
            Replace your current{' '}
            {stage === 'base' ? 'base problem' : 'follow-up lab'} code with the
            starter code? Your notes and saved submissions will be kept.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                patchCode(p.starter);
                setProposal(null);
                setUndo(null);
                setResult(null);
                setRunCode('');
                setPhase('');
                setResetOpen(false);
                setNotice('Starter code restored.');
              }}
            >
              Reset code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="practice-controls">
        <Button variant="ghost" onClick={onLibrary}>
          <ChevronLeft /> Problems
        </Button>
        <Button
          variant="ghost"
          aria-label="Previous problem"
          onClick={() =>
            onNavigate(list[(index - 1 + list.length) % list.length].id)
          }
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          aria-label="Next problem"
          onClick={() => onNavigate(list[(index + 1) % list.length].id)}
        >
          <ChevronRight />
        </Button>
        {isCode && (
          <div className="tab-switch workspace-tabs">
            {(['base', 'followup'] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-slot="tabs-trigger"
                aria-pressed={stage === value}
                onClick={() => onStage(value)}
              >
                {value === 'base' ? 'Base problem' : 'Follow-up lab'}
              </button>
            ))}
          </div>
        )}
        <div className="toolbar-spacer" />
        <label htmlFor="mock-mode">
          <Checkbox
            id="mock-mode"
            checked={mock}
            onCheckedChange={(v) => setMock(!!v)}
          />{' '}
          Mock mode
        </label>
        <label>
          <Checkbox
            disabled={!loaded}
            checked={!!(stage === 'base' ? draft.done : draft.followupDone)}
            onCheckedChange={(v) =>
              onPatch(stage === 'base' ? { done: !!v } : { followupDone: !!v })
            }
          />{' '}
          Reviewed
        </label>
        <Button
          variant="ghost"
          aria-label={running ? 'Pause timer' : 'Start timer'}
          onClick={onClockToggle}
          disabled={seconds === 0}
        >
          <Clock3 />
          <span className="timer-value">
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:
            {String(seconds % 60).padStart(2, '0')}
          </span>
        </Button>
        <Button variant="ghost" aria-label="Reset timer" onClick={onClockReset}>
          <RotateCcw />
        </Button>
      </div>
      <div className={`workspace-panels ${coachOpen ? 'with-coach' : ''}`}>
        <ResizablePanelGroup
          orientation={narrow ? 'vertical' : 'horizontal'}
          key={narrow ? 'vertical' : 'horizontal'}
        >
          <ResizablePanel
            id="question"
            defaultSize="44%"
            minSize={narrow ? '20%' : '26%'}
          >
            {left}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="editor"
            defaultSize="56%"
            minSize={narrow ? '35%' : '30%'}
          >
            {editor}
          </ResizablePanel>
        </ResizablePanelGroup>
        <div className="coach-dock" id="lab-coach-dock" hidden={!coachOpen}>
          <AICoach
            ref={coach}
            apiKey={apiKey}
            context={context()}
            code={isCode ? code : undefined}
            mock={mock}
            onSettings={onSettings}
            onClose={() => {
              setCoachOpen(false);
              coachToggle.current?.focus();
            }}
            onProposal={(value) => {
              setProposal(value);
              if (value.base !== code)
                setNotice(
                  'This suggestion is for a different code snapshot. Load that submission or request a fresh hint.',
                );
              else
                setNotice(
                  'Review each proposed change in the editor. Nothing changes until you accept.',
                );
            }}
          />
        </div>
      </div>
    </div>
  );
}
