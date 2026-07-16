/**
 * The structure of a system design interview, shared by every scenario.
 *
 * A scenario supplies its own rubric (`expects` per section); these entries
 * supply the section the interviewer opens with and the shape of the
 * conversation. The two together are the grader's brief.
 */
export const DESIGN_SECTIONS = [
  {
    id: 'scope',
    title: 'Scope & requirements',
    minutes: 8,
    prompt:
      'Before drawing anything, agree what the system has to do and what it explicitly does not. Name the users and the primary flows, list the functional requirements, and call out at least one thing you are deliberately leaving out of scope and why.',
  },
  {
    id: 'estimates',
    title: 'Scale & estimates',
    minutes: 10,
    prompt:
      'Work out the scale. Take the traffic figure and derive request rate, storage volume and bandwidth, showing the arithmetic. Then name the single resource that becomes the constraint first, and say what happens when it saturates.',
  },
  {
    id: 'data',
    title: 'APIs & data model',
    minutes: 12,
    prompt:
      'Define the interfaces and the records. Give the shape of the main request and response, name the entities you are storing and their keys, and explain how the data model supports the access patterns you just estimated.',
  },
  {
    id: 'flow',
    title: 'Architecture & request flow',
    minutes: 10,
    prompt:
      'Walk the primary request end to end, naming every component it touches and in what order. Then do the same for one non-obvious path, such as a read that can be served from cache or a write that fans out.',
  },
  {
    id: 'failure',
    title: 'Failure & tradeoffs',
    minutes: 12,
    prompt:
      'Now break it. Pick the failure you consider most likely and describe what the system does, including retries, idempotency and what the user sees. Then state the main tradeoff you accepted to get the design you chose, and what would make you revisit it.',
  },
  {
    id: 'ops',
    title: 'Operations & observability',
    minutes: 8,
    prompt:
      'Finish with running it. Say which metrics and alerts tell you the system is healthy, how you would roll out a change to it safely, and which single security or abuse concern matters most here.',
  },
] as const;

export type DesignSectionId = (typeof DESIGN_SECTIONS)[number]['id'];

export const SECTION_IDS: DesignSectionId[] = DESIGN_SECTIONS.map((s) => s.id);

export function isSectionId(value: unknown): value is DesignSectionId {
  return (
    typeof value === 'string' && SECTION_IDS.includes(value as DesignSectionId)
  );
}

export function sectionById(id: string) {
  return DESIGN_SECTIONS.find((s) => s.id === id);
}

/** Follow-up rounds allowed per section before the reference is revealed. */
export const MAX_FOLLOWUPS = 3;

/** Rubric points available per section. */
export const MAX_SECTION_SCORE = 4;

export type SectionGrade = {
  /** 0..MAX_SECTION_SCORE, derived server-side from rubric items met. */
  score: number;
  /** How many rubric items the grader found. */
  met: number;
  /** How many rubric items there were. */
  total: number;
  strengths: string[];
  gaps: string[];
  /** True when the grader had no further question to ask. */
  passed: boolean;
};

export type SectionTurn = {
  question: string;
  answer: string;
  score: number;
  met: number;
  total: number;
};

export type SectionState = {
  answer: string;
  /** Unsent follow-up text, kept when navigating or reloading. */
  reply?: string;
  /** Follow-up rounds already answered, oldest first. */
  turns: SectionTurn[];
  /** A question asked but not yet answered, if any. */
  pending?: string;
  grade?: SectionGrade;
};

export type DesignDraft = {
  sections: Record<string, SectionState>;
  done?: boolean;
};

/**
 * A section is finished when the grader had nothing left to ask, or when the
 * follow-up budget is spent. Deliberately derived rather than stored, so the
 * stored state cannot disagree with it.
 */
export function sectionDone(state: SectionState | undefined): boolean {
  if (!state?.grade) return false;
  return state.grade.passed || state.turns.length >= MAX_FOLLOWUPS;
}

/** How much help the candidate needed to get through a section. */
export type Guidance = 'unaided' | 'guided' | 'heavy' | 'revealed';

export function guidanceOf(turns: number, passed: boolean): Guidance {
  if (passed && turns === 0) return 'unaided';
  if (turns <= 1) return 'guided';
  if (turns < MAX_FOLLOWUPS) return 'heavy';
  return 'revealed';
}

export const GUIDANCE_LABEL: Record<Guidance, string> = {
  unaided: 'Reached unaided',
  guided: '1 follow-up',
  heavy: `${MAX_FOLLOWUPS - 1}+ follow-ups`,
  revealed: 'Reference revealed',
};

export type Scorecard = {
  /** Rubric points earned across every section that has a grade. */
  earned: number;
  /** Rubric points available across graded sections. */
  possible: number;
  graded: number;
  unaided: number;
  total: number;
};

/**
 * Progress and score are deliberately independent: a section can be finished
 * and still have scored badly, so this only totals sections that were graded.
 */
export function scorecard(draft: DesignDraft | undefined): Scorecard {
  const total = DESIGN_SECTIONS.length;
  const out: Scorecard = {
    earned: 0,
    possible: 0,
    graded: 0,
    unaided: 0,
    total,
  };
  for (const section of DESIGN_SECTIONS) {
    const state = draft?.sections?.[section.id];
    if (!state?.grade) continue;
    out.graded += 1;
    out.earned += state.grade.score;
    out.possible += MAX_SECTION_SCORE;
    if (guidanceOf(state.turns.length, state.grade.passed) === 'unaided')
      out.unaided += 1;
  }
  return out;
}
