import {
  DESIGN_SECTIONS,
  MAX_FOLLOWUPS,
  MAX_SECTION_SCORE,
  isSectionId,
  type DesignDraft,
  type SectionState,
} from './design.ts';

export type Draft = {
  code?: string;
  answer?: string;
  notes?: string;
  done?: boolean;
  followupCode?: string;
  followupNotes?: string;
  followupDone?: boolean;
  design?: DesignDraft;
};

const str = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined;
const list = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .slice(0, max)
        .map((s) => (typeof s === 'string' ? s : ''))
        .filter((s) => !!s.trim())
    : [];
const int = (value: unknown, max: number): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max
    ? value
    : undefined;

const readGrade = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const g = value as Record<string, unknown>;
  const score = int(g.score, MAX_SECTION_SCORE);
  const total = int(g.total, 8);
  const met = int(g.met, 8);
  if (score === undefined || total === undefined || met === undefined)
    return undefined;
  return {
    score,
    met: Math.min(met, total),
    total,
    strengths: list(g.strengths, 3),
    gaps: list(g.gaps, 3),
    passed: g.passed === true,
  };
};

const readSection = (value: unknown): SectionState | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const s = value as Record<string, unknown>;
  const answer = str(s.answer, 20000);
  if (answer === undefined) return undefined;
  const turns = Array.isArray(s.turns)
    ? s.turns
        .slice(0, MAX_FOLLOWUPS)
        .map((t) => {
          if (!t || typeof t !== 'object' || Array.isArray(t)) return undefined;
          const turn = t as Record<string, unknown>;
          const question = str(turn.question, 600);
          const reply = str(turn.answer, 20000);
          const score = int(turn.score, MAX_SECTION_SCORE);
          const total = int(turn.total, 8);
          const met = int(turn.met, 8);
          if (
            question === undefined ||
            reply === undefined ||
            score === undefined ||
            total === undefined ||
            met === undefined
          )
            return undefined;
          return { question, answer: reply, score, met, total };
        })
        .filter((t): t is SectionState['turns'][number] => !!t)
    : [];
  return {
    answer,
    turns,
    pending: str(s.pending, 600) || undefined,
    reply: str(s.reply, 20000) || undefined,
    grade: readGrade(s.grade),
  };
};

/**
 * Validates a saved design draft. Anything malformed is dropped rather than
 * thrown, matching how the flat draft fields behave, and an unreadable design
 * block is discarded whole so a partial write cannot masquerade as real work.
 */
export function readDesignDraft(value: unknown): DesignDraft | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const raw = (value as { sections?: unknown }).sections;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const sections: Record<string, SectionState> = {};
  for (const id of DESIGN_SECTIONS.map((s) => s.id)) {
    if (!isSectionId(id) || !(id in raw)) continue;
    const section = readSection((raw as Record<string, unknown>)[id]);
    // An empty section is not worth storing, and keeping one would make the
    // library report work in progress that does not exist.
    if (
      section &&
      (section.answer.trim() ||
        section.grade ||
        section.pending ||
        section.reply)
    )
      Object.defineProperty(sections, id, {
        value: section,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return { sections };
}

/**
 * A design answer written before the section flow existed. It is kept rather
 * than discarded, because it is the candidate's own work.
 */
export function legacyAnswer(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

/**
 * Folds a pre-section-flow design answer into the first section, so opening the
 * new flow does not present an empty interview to someone with a finished
 * draft. Mutates in place and leaves the original field alone: nothing is
 * destroyed, and the old single-answer shape is still readable.
 */
export function migrateDrafts(drafts: Record<string, Draft>): void {
  for (const draft of Object.values(drafts)) {
    const answer = legacyAnswer(draft.answer);
    if (!answer || draft.design) continue;
    Object.defineProperty(draft, 'design', {
      value: { sections: { scope: { answer, turns: [] } } },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

export function readDrafts(value: string | null): Record<string, Draft> {
  const raw: unknown = JSON.parse(value || '{}');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid drafts');
  const clean: Record<string, Draft> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const draft: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entry)) {
      if (
        ['code', 'answer', 'notes', 'followupCode', 'followupNotes'].includes(
          key,
        ) &&
        typeof val === 'string'
      )
        draft[key] = val;
      if (['done', 'followupDone'].includes(key) && typeof val === 'boolean')
        draft[key] = val;
      if (key === 'design') {
        const design = readDesignDraft(val);
        if (design) draft.design = design;
      }
    }
    Object.defineProperty(clean, id, {
      value: draft,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return clean;
}
export function statusOf(
  draft?: Draft,
): 'Reviewed' | 'In progress' | 'Not started' {
  if (draft?.done || draft?.followupDone) return 'Reviewed';
  const design = draft?.design;
  if (design && Object.keys(design.sections).length) {
    // A design interview is only reviewed once every section is finished.
    const finished = DESIGN_SECTIONS.filter((s) => {
      const state = design.sections[s.id];
      return (
        !!state?.grade &&
        (state.grade.passed || state.turns.length >= MAX_FOLLOWUPS)
      );
    }).length;
    if (finished === DESIGN_SECTIONS.length) return 'Reviewed';
    return 'In progress';
  }
  return draft &&
    [
      draft.code,
      draft.answer,
      draft.notes,
      draft.followupCode,
      draft.followupNotes,
    ].some((v) => !!v?.trim())
    ? 'In progress'
    : 'Not started';
}
export function filterProblems<
  T extends { id: string; title: string; topic: string },
>(
  problems: T[],
  drafts: Record<string, Draft>,
  query: string,
  topic = 'All topics',
  status = 'All statuses',
): T[] {
  return problems.filter(
    (p) =>
      `${p.title} ${p.topic}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (topic === 'All topics' || p.topic === topic) &&
      (status === 'All statuses' || statusOf(drafts[p.id]) === status),
  );
}
