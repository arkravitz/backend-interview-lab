'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Circle,
  Gauge,
  Lightbulb,
  Lock,
  MessageSquare,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DifficultyBadge } from '@/components/difficulty-badge';
import { FormattedText, InlineText } from '@/components/formatted-text';
import {
  DESIGN_SECTIONS,
  GUIDANCE_LABEL,
  MAX_FOLLOWUPS,
  MAX_SECTION_SCORE,
  guidanceOf,
  scorecard,
  sectionById,
  sectionDone,
  type SectionGrade,
  type SectionState,
} from '@/lib/design';
import type { Draft } from '@/lib/practice';

type Scenario = {
  id: string;
  title: string;
  minutes: number;
  statement: string;
  assumptions: string[];
  rubric: { section: string; expects: string[] }[];
  probes: { section: string; question: string; difficulty: string }[];
  failures: { section: string; scenario: string }[];
};

type Reference = {
  references: Record<string, string>;
  probes: { question: string; answer: string }[];
  failures: { scenario: string; expected: string }[];
};

type Verdict = {
  score: number;
  met: number;
  total: number;
  strengths: string[];
  gaps: string[];
  followUp: string;
};

const expectsFor = (scenario: Scenario, section: string) =>
  scenario.rubric.find((r) => r.section === section)?.expects ?? [];

const stateOf = (draft: Draft | undefined, section: string) =>
  draft?.design?.sections?.[section];

/** The section a candidate should be looking at: the first one not finished. */
function resumeSection(draft: Draft | undefined): string {
  const next = DESIGN_SECTIONS.find((s) => !sectionDone(stateOf(draft, s.id)));
  return next ? next.id : DESIGN_SECTIONS[DESIGN_SECTIONS.length - 1].id;
}

function scoreTone(score: number, total: number) {
  if (!total) return 'none';
  if (score >= MAX_SECTION_SCORE) return 'full';
  if (score >= MAX_SECTION_SCORE / 2) return 'part';
  return 'thin';
}

function GradeCard({ grade }: { grade: SectionGrade }) {
  const tone = scoreTone(grade.score, grade.total);
  return (
    <div className={`design-grade ${tone}`}>
      <div className="design-grade-head">
        <Gauge size={16} />
        <b>
          {grade.score} of {MAX_SECTION_SCORE}
        </b>
        <span>
          met {grade.met} of {grade.total} points in this section
        </span>
      </div>
      {grade.strengths.length > 0 && (
        <div className="design-grade-list good">
          <b>What landed</b>
          <ul>
            {grade.strengths.map((s) => (
              <li key={s}>
                <InlineText text={s} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {grade.gaps.length > 0 && (
        <div className="design-grade-list gap">
          <b>Still missing</b>
          <ul>
            {grade.gaps.map((g) => (
              <li key={g}>
                <InlineText text={g} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {grade.strengths.length === 0 && grade.gaps.length === 0 && (
        <p className="muted">The interviewer had nothing to add on this one.</p>
      )}
    </div>
  );
}

export function DesignSectionList({
  scenario,
  draft,
  active,
  onPick,
  disabled,
}: {
  scenario: Scenario;
  draft: Draft | undefined;
  active: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <ol className="design-section-list">
      {DESIGN_SECTIONS.map((section) => {
        const state = stateOf(draft, section.id);
        const done = sectionDone(state);
        const injected = scenario.failures.filter(
          (f) => f.section === section.id,
        ).length;
        return (
          <li key={section.id}>
            <button
              type="button"
              aria-current={active === section.id ? 'step' : undefined}
              className={active === section.id ? 'current' : undefined}
              disabled={disabled}
              onClick={() => onPick(section.id)}
            >
              {done ? (
                <Check className="success" size={15} />
              ) : (
                <Circle size={15} />
              )}
              <span>
                <b>{section.title}</b>
                <small>
                  {section.minutes} min
                  {done ? ' · complete' : ''}
                  {state?.grade
                    ? ` · ${state.grade.score}/${MAX_SECTION_SCORE}`
                    : ''}
                  {injected ? ` · ${injected} failure drill` : ''}
                </small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The interview itself: one section at a time, graded by the model, with the
 * interviewer asking a follow-up until the section holds up or the budget runs
 * out. Progress and score are tracked separately on purpose.
 */
export function DesignFlow({
  scenario,
  reference,
  draft,
  mock,
  apiKey,
  onSettings,
  onPatch,
}: {
  scenario: Scenario;
  reference: Reference;
  draft: Draft | undefined;
  mock: boolean;
  apiKey: string;
  onSettings: () => void;
  onPatch: (change: Partial<Draft>) => void;
}) {
  const [active, setActive] = useState(() => resumeSection(draft));
  const [busy, setBusy] = useState(false);
  return (
    <div className="design-flow">
      <div className="design-flow-intro">
        <div>
          <b>Practise a design interview, one section at a time</b>
          <p>
            Write your reasoning, submit for rubric feedback, then answer the
            interviewer&apos;s follow-up. Your drafts save in this browser.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onSettings}
          disabled={busy}
          className="design-connection"
        >
          <span className={apiKey ? 'design-connected' : ''} aria-hidden="true">
            ●
          </span>
          {apiKey ? 'DeepSeek key saved' : 'Connect DeepSeek'}
        </Button>
      </div>
      <DesignSectionList
        scenario={scenario}
        draft={draft}
        active={active}
        onPick={setActive}
        disabled={busy}
      />
      {/* Replies live in the draft; keyed cards reset transient feedback. */}
      <DesignSectionCard
        key={active}
        sectionId={active}
        scenario={scenario}
        reference={reference}
        draft={draft}
        mock={mock}
        apiKey={apiKey}
        onSettings={onSettings}
        onPatch={onPatch}
        onNext={(id) => setActive(id)}
        onBusy={setBusy}
      />
    </div>
  );
}

function DesignSectionCard({
  sectionId,
  scenario,
  reference,
  draft,
  mock,
  apiKey,
  onSettings,
  onPatch,
  onNext,
  onBusy,
}: {
  sectionId: string;
  scenario: Scenario;
  reference: Reference;
  draft: Draft | undefined;
  mock: boolean;
  apiKey: string;
  onSettings: () => void;
  onPatch: (change: Partial<Draft>) => void;
  onNext: (id: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scrollRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const section = sectionById(sectionId) ?? DESIGN_SECTIONS[0];
  const state = stateOf(draft, sectionId);
  const answer = state?.answer ?? '';
  const reply = state?.reply ?? '';
  const turns = state?.turns ?? [];
  const pending = state?.pending;
  const grade = state?.grade;
  const done = sectionDone(state);
  const budgetLeft = MAX_FOLLOWUPS - turns.length;
  const injected = scenario.failures.filter((f) => f.section === sectionId);

  const save = (change: Partial<SectionState>) =>
    onPatch({
      design: {
        ...draft?.design,
        sections: {
          ...draft?.design?.sections,
          [sectionId]: { answer, reply, turns, pending, grade, ...change },
        },
      } as Draft['design'],
    });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    return () => {
      requestRef.current?.abort();
      onBusy(false);
    };
  }, [onBusy]);

  async function review(extraTurn?: { question: string; answer: string }) {
    if (busy || mock || requestRef.current) return;
    if (!apiKey) {
      onSettings();
      return;
    }
    const nextTurns = extraTurn
      ? [...turns, { ...extraTurn, score: 0, met: 0, total: 0 }]
      : turns;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/design', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          problemId: scenario.id,
          scenarioTitle: scenario.title,
          scenarioStatement: scenario.statement,
          assumptions: scenario.assumptions,
          section: sectionId,
          title: section.title,
          prompt: section.prompt,
          answer,
          rubric: expectsFor(scenario, sectionId),
          probes: scenario.probes
            .filter((p) => p.section === sectionId)
            .map((p) => p.question),
          failures: injected.map((f) => f.scenario),
          turns: nextTurns.map((t) => ({
            question: t.question,
            answer: t.answer,
          })),
          lastChance: nextTurns.length >= MAX_FOLLOWUPS - 1,
        }),
      });
      const data = (await response.json()) as Verdict & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok)
        throw new Error(data.error || 'Could not reach the interviewer.');
      // A 200 with an unreadable body must not be saved as a grade of zero.
      if (
        typeof data.score !== 'number' ||
        typeof data.total !== 'number' ||
        typeof data.met !== 'number'
      )
        throw new Error(
          'The interviewer sent back something unreadable. Nothing was saved. Please try again.',
        );
      const canAsk = !!data.followUp && nextTurns.length < MAX_FOLLOWUPS;
      // The score recorded against a turn is the score after it was answered.
      const scored = nextTurns.map((t, i) =>
        extraTurn && i === nextTurns.length - 1
          ? { ...t, score: data.score, met: data.met, total: data.total }
          : t,
      );
      save({
        reply: '',
        turns: scored,
        pending: canAsk ? data.followUp : undefined,
        grade: {
          score: data.score,
          met: data.met,
          total: data.total,
          strengths: data.strengths ?? [],
          gaps: data.gaps ?? [],
          passed: !data.followUp,
        },
      });
      if (!canAsk && data.followUp)
        setNotice(
          'Follow-up budget spent. Move on, then compare your answer with the reference in the Solution tab.',
        );
      else if (!canAsk)
        setNotice(
          'Section accepted. The interviewer has no further questions.',
        );
    } catch (e) {
      if (controller.signal.aborted) return;
      // Nothing is saved on failure, so the candidate's work and their
      // follow-up count are untouched and a retry costs nothing.
      setError(
        e instanceof Error ? e.message : 'Could not reach the interviewer.',
      );
    } finally {
      requestRef.current = null;
      setBusy(false);
      onBusy(false);
    }
  }

  const index = DESIGN_SECTIONS.findIndex((s) => s.id === sectionId);
  const next = DESIGN_SECTIONS[index + 1];
  const finished = DESIGN_SECTIONS.every((s) =>
    sectionDone(stateOf(draft, s.id)),
  );
  const placeholders: Record<string, string> = {
    scope:
      'Who uses this system? Describe the main flows, requirements and what you leave out of scope.',
    estimates:
      'Show your arithmetic for requests per second, storage and bandwidth. Identify the first bottleneck.',
    data: 'Sketch request and response fields, entities and keys. Explain the queries your model must support.',
    flow: 'Trace a request through each component. Explain the cache, queue and persistence boundaries you choose.',
    failure:
      'Describe a failure, how retries stay safe and what the user sees. Explain the tradeoff you accept.',
    ops: 'Name metrics and alert thresholds, a safe rollout plan and the main security or abuse control.',
  };
  const nextStep = mock
    ? 'Write your answer. Turn mock mode off when you want feedback.'
    : !apiKey
      ? 'Connect DeepSeek to review your answer. You can write and save it now.'
      : busy
        ? 'The interviewer is reviewing your answer. Your draft is saved.'
        : pending
          ? 'Read the feedback, then answer the interviewer’s question below.'
          : done
            ? next
              ? 'This section is complete. Compare your reasoning, then move to the next section.'
              : 'This section is complete. Check your report for any unfinished sections.'
            : 'Write your answer and submit it for feedback against this section’s rubric.';

  return (
    <section
      className="design-section"
      aria-label={section.title}
      ref={scrollRef}
    >
      <header>
        <p className="design-section-eyebrow">
          Section {index + 1} of {DESIGN_SECTIONS.length} · {section.minutes}{' '}
          minutes
        </p>
        <h2>{section.title}</h2>
        <p className="design-prompt">{section.prompt}</p>
      </header>

      <div className="design-next-step" aria-live="polite">
        <b>Your next step</b>
        <p>{nextStep}</p>
      </div>
      <details className="design-answer-guide">
        <summary>What to cover in this answer</summary>
        <ul>
          {expectsFor(scenario, sectionId).map((item) => (
            <li key={item}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      </details>

      {injected.length > 0 && (
        <div className="design-injected" role="note">
          <AlertTriangle size={16} />
          <div>
            <b>The interviewer raises this before you answer</b>
            {injected.map((f) => (
              <p key={f.scenario}>{f.scenario}</p>
            ))}
          </div>
        </div>
      )}

      {mock ? (
        <div className="design-mock-note">
          <Lock size={15} />
          <p>
            Mock mode is on, so grading is paused and the reference answer stays
            hidden. Write your answer anyway, then turn mock off to have it
            reviewed.
          </p>
        </div>
      ) : null}

      <label className="design-answer-label" htmlFor="design-answer">
        Your answer
      </label>
      <textarea
        id="design-answer"
        aria-label={`Your answer for ${section.title}`}
        placeholder={placeholders[sectionId]}
        maxLength={8000}
        aria-describedby="design-answer-count"
        value={answer}
        onChange={(e) => {
          if (grade)
            setNotice('Answer changed. Submit again for fresh feedback.');
          save({
            answer: e.target.value,
            turns: [],
            pending: undefined,
            grade: undefined,
            reply: '',
          });
        }}
        disabled={busy}
        rows={8}
      />
      <small className="design-character-count" id="design-answer-count">
        {answer.length.toLocaleString()} / 8,000 characters
      </small>
      {grade && !mock && <GradeCard grade={grade} />}

      {turns.length > 0 && (
        <details className="design-turns">
          <summary>Previous follow-ups ({turns.length})</summary>
          {turns.map((t, i) => (
            <div className="design-turn" key={i}>
              <p className="q">
                <MessageSquare size={14} /> {t.question}
              </p>
              <p className="a">{t.answer}</p>
              <small>
                {t.met} of {t.total} rubric points at that point
              </small>
            </div>
          ))}
        </details>
      )}

      {pending && (
        <div className="design-pending">
          <p className="q">
            <MessageSquare size={14} /> {pending}
          </p>
          <label className="design-answer-label" htmlFor="design-reply">
            Your answer to that
          </label>
          <textarea
            id="design-reply"
            aria-label="Your answer to the follow-up"
            value={reply}
            onChange={(e) => save({ reply: e.target.value })}
            maxLength={8000}
            aria-describedby="design-reply-count"
            disabled={busy}
            rows={5}
          />
          <small className="design-character-count" id="design-reply-count">
            {reply.length.toLocaleString()} / 8,000 characters
          </small>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}

      <div className="design-actions">
        {pending ? (
          <Button
            disabled={busy || mock || !reply.trim()}
            onClick={() => {
              const question = pending;
              const text = reply.trim();
              void review({ question, answer: text });
            }}
          >
            {busy ? 'Reviewing…' : 'Answer the follow-up'}
          </Button>
        ) : (
          <Button
            disabled={busy || mock || !answer.trim()}
            onClick={() => void review()}
          >
            {busy
              ? 'Reviewing…'
              : turns.length
                ? 'Review again'
                : 'Submit for review'}
          </Button>
        )}
        {grade && (
          <span className="design-budget">
            {done
              ? 'Section complete'
              : `${budgetLeft} follow-up${budgetLeft === 1 ? '' : 's'} left`}
          </span>
        )}
        <div className="toolbar-spacer" />
        {next ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onNext(next.id)}
          >
            Next: {next.title} <ArrowRight size={15} />
          </Button>
        ) : (
          finished && (
            <span className="design-budget">
              All {DESIGN_SECTIONS.length} sections complete.
            </span>
          )
        )}
      </div>

      {done && !mock && reference.references[sectionId] && (
        <details className="design-reference">
          <summary>
            <Lightbulb size={15} /> Compare with a strong answer
          </summary>
          <FormattedText text={reference.references[sectionId]} diagrams />
        </details>
      )}

      {grade && !mock && !done && (
        <p className="muted design-reopen">
          Not happy with the grade? Change your answer above and review again.{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              save({
                turns: [],
                pending: undefined,
                grade: undefined,
                reply: '',
              })
            }
          >
            Re-open this section
          </button>{' '}
          to clear your follow-up count.
        </p>
      )}
    </section>
  );
}

/** The report: rubric points and how much help each section needed. */
export function DesignScorecard({ draft }: { draft: Draft | undefined }) {
  const total = scorecard(draft?.design);
  const any = total.graded > 0;
  return (
    <div className="design-scorecard">
      <h1>Interview report</h1>
      {!any ? (
        <p className="muted">
          Nothing reviewed yet. Work through a section and the report builds
          itself.
        </p>
      ) : (
        <>
          <div className="design-totals">
            <div>
              <b>
                {total.earned}
                <small> / {total.possible || 0}</small>
              </b>
              <span>rubric points</span>
            </div>
            <div>
              <b>
                {total.unaided}
                <small> / {total.graded}</small>
              </b>
              <span>reached unaided</span>
            </div>
            <div>
              <b>
                {total.graded}
                <small> / {total.total}</small>
              </b>
              <span>sections reviewed</span>
            </div>
          </div>
          <table className="design-report">
            <thead>
              <tr>
                <th>Section</th>
                <th>Rubric</th>
                <th>Guidance</th>
                <th>Still missing</th>
              </tr>
            </thead>
            <tbody>
              {DESIGN_SECTIONS.map((section) => {
                const state = stateOf(draft, section.id);
                if (!state?.grade) return null;
                const tone = scoreTone(state.grade.score, state.grade.total);
                const guidance = guidanceOf(
                  state.turns.length,
                  state.grade.passed,
                );
                return (
                  <tr key={section.id}>
                    <th scope="row">{section.title}</th>
                    <td>
                      <span className={`design-pill ${tone}`}>
                        {state.grade.score}/{MAX_SECTION_SCORE}
                      </span>
                      <small>
                        {state.grade.met} of {state.grade.total} items
                      </small>
                    </td>
                    <td>
                      <span className={`design-pill guidance-${guidance}`}>
                        {GUIDANCE_LABEL[guidance]}
                      </span>
                    </td>
                    <td>
                      {state.grade.gaps.length ? (
                        <ul>
                          {state.grade.gaps.map((g) => (
                            <li key={g}>
                              <InlineText text={g} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">Nothing outstanding.</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted design-progress-note">
            {
              DESIGN_SECTIONS.filter((s) => sectionDone(stateOf(draft, s.id)))
                .length
            }{' '}
            of {total.total} sections complete. A review gives a score; a
            section completes when no follow-up remains or the follow-up budget
            is spent.
          </p>
          <p className="muted design-caveat">
            <Target size={14} /> Rubric points and guidance are reported
            separately on purpose. A section reached with three follow-ups is a
            different result from the same section reached unaided, and
            averaging them into one number would hide the thing you most want to
            see. This is practice feedback, not a hiring prediction.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The follow-up questions this scenario's interviewer is likely to ask, in the
 * order it asks them. Shown while practising for the same reason the rubric is:
 * the target should not be hidden. The answers live in the Solution tab.
 */
export function DesignProbes({ scenario }: { scenario: Scenario }) {
  if (!scenario.probes.length) return null;
  return (
    <div className="design-probes">
      <h2>Follow-up questions</h2>
      <p className="muted">
        These are the questions a strong interviewer is likely to ask, grouped
        by the section they belong to. Aim to have an answer ready for each. The
        worked answers are in the Solution tab.
      </p>
      {DESIGN_SECTIONS.map((section) => {
        const questions = scenario.probes.filter(
          (p) => p.section === section.id,
        );
        if (!questions.length) return null;
        return (
          <details key={section.id}>
            <summary>{section.title}</summary>
            <ol>
              {questions.map((p) => (
                <li key={p.question}>
                  <div className="followup-question-row">
                    <span>
                      <InlineText text={p.question} />
                    </span>
                    <DifficultyBadge difficulty={p.difficulty} />
                  </div>
                  <small>asked at around {section.minutes} minutes in</small>
                </li>
              ))}
            </ol>
          </details>
        );
      })}
    </div>
  );
}

/**
 * Everything revealed after the interview. Mock mode is already handled by the
 * tab that hosts this, so there is no second guard here to keep in step.
 */
export function DesignSolution({
  scenario,
  reference,
}: {
  scenario: Scenario;
  reference: Reference;
}) {
  return (
    <div className="design-solution">
      <h1>Reference answers</h1>
      <p className="muted">
        One section at a time, in the order the interview runs. Each section
        gives a reference answer, the worked answers to that section&apos;s
        follow-up questions, and how to handle the failure drills injected
        there. Use the diagrams to trace requests and explain the decisions at
        each boundary.
      </p>
      <nav className="design-reference-nav" aria-label="Reference sections">
        {DESIGN_SECTIONS.map((section) => (
          <a key={section.id} href={`#reference-${section.id}`}>
            {section.title}
          </a>
        ))}
      </nav>
      {DESIGN_SECTIONS.map((section) => {
        const probes = scenario.probes.filter((p) => p.section === section.id);
        const failures = scenario.failures.filter(
          (f) => f.section === section.id,
        );
        return (
          <section key={section.id} id={`reference-${section.id}`}>
            <h2>{section.title}</h2>
            {failures.length > 0 && (
              <div className="design-solution-block">
                <h3>
                  <AlertTriangle size={14} /> Failure drills
                </h3>
                {failures.map((f) => {
                  const answer = reference.failures.find(
                    (x) => x.scenario === f.scenario,
                  );
                  return (
                    <div key={f.scenario}>
                      <p className="design-scenario">{f.scenario}</p>
                      {answer && <FormattedText text={answer.expected} />}
                    </div>
                  );
                })}
              </div>
            )}
            {reference.references[section.id] && (
              <div className="design-solution-block">
                <h3>Reference answer</h3>
                <FormattedText
                  text={reference.references[section.id]}
                  diagrams
                />
              </div>
            )}
            {probes.length > 0 && (
              <div className="design-solution-block">
                <h3>
                  <MessageSquare size={14} /> Follow-up questions
                </h3>
                {probes.map((p, i) => {
                  const answer = reference.probes.find(
                    (x) => x.question === p.question,
                  );
                  return (
                    <div className="design-probe-answer" key={p.question}>
                      <p className="design-scenario followup-question-row">
                        <span>
                          {i + 1}. {p.question}
                        </span>
                        <DifficultyBadge difficulty={p.difficulty} />
                      </p>
                      {answer ? (
                        <FormattedText text={answer.answer} />
                      ) : (
                        <p className="muted">No answer recorded for this.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The rubric, shown while practising so the target is never hidden. */
export function DesignRubric({
  scenario,
  active,
}: {
  scenario: Scenario;
  active?: string;
}) {
  return (
    <div className="design-rubric">
      <h2>What a strong answer covers</h2>
      <p className="muted">
        This is the marking scheme, per section. The interviewer checks these
        against your answer; it is not a checklist to satisfy mechanically.
      </p>
      {DESIGN_SECTIONS.map((section) => (
        <details
          key={section.id}
          open={active === section.id}
          className={active === section.id ? 'current' : undefined}
        >
          <summary>{section.title}</summary>
          <ul>
            {expectsFor(scenario, section.id).map((e) => (
              <li key={e}>
                <InlineText text={e} />
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
