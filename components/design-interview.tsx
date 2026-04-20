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

