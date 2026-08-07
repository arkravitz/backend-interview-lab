export type SuggestedEdit = {
  before: string;
  after: string;
  explanation: string;
};
export type Walkthrough = {
  title: string;
  explanation: string;
  hints: string[];
  steps: string[];
  solution: string;
  edits: SuggestedEdit[];
};
export type Proposal = { base: string; edits: SuggestedEdit[] };
type Range = { from: number; to: number };
const MAX_EDITS = 6;
const text = (x: unknown, max = 12000): x is string =>
  typeof x === 'string' && x.trim().length > 0 && x.length <= max;
function contentOf(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid review');
  const v = value as Record<string, unknown>;
  if (
    !text(v.title, 200) ||
    !text(v.explanation) ||
    !text(v.solution) ||
    !Array.isArray(v.hints) ||
    v.hints.length !== 3 ||
    !v.hints.every((x) => text(x)) ||
    !Array.isArray(v.steps) ||
    !v.steps.length ||
    v.steps.length > 8 ||
    !v.steps.every((x) => text(x)) ||
    !Array.isArray(v.edits)
  )
    throw new Error('Incomplete review');
  return {
    title: v.title as string,
    explanation: v.explanation as string,
    hints: v.hints as string[],
    steps: v.steps as string[],
    solution: v.solution,
    edits: v.edits as unknown[],
  };
}
function parseEdit(item: unknown): SuggestedEdit {
  if (!item || typeof item !== 'object') throw new Error('Invalid edit');
  const e = item as Record<string, unknown>;
  if (
    !text(e.before, 20000) ||
    typeof e.after !== 'string' ||
    e.after.length > 20000 ||
    e.before === e.after ||
    !text(e.explanation, 2000)
  )
    throw new Error('Invalid edit');
  return { before: e.before, after: e.after, explanation: e.explanation };
}
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Locate `before` in `code`. An exact unique match wins. Otherwise retry with
// flexible whitespace so a snippet survives re-indentation or spacing drift.
// Returns null when there is no match or the snippet is ambiguous.
function locate(code: string, before: string): Range | null {
  const exact = code.indexOf(before);
  if (exact >= 0 && code.indexOf(before, exact + 1) === -1)
    return { from: exact, to: exact + before.length };
  const needle = before.trim();
  if (!needle) return null;
  const body = escapeRegExp(needle).replace(/\s+/g, '\\s+');
  const head = /[A-Za-z0-9_]/.test(needle[0]) ? '\\b' : '';
  const tail = /[A-Za-z0-9_]/.test(needle.slice(-1)) ? '\\b' : '';
  const matches = [...code.matchAll(new RegExp(`${head}${body}${tail}`, 'g'))];
  if (matches.length !== 1) return null;
  return {
    from: matches[0].index,
    to: matches[0].index + matches[0][0].length,
  };
}
function indentOf(line: string) {
  return /^[ \t]*/.exec(line)?.[0] || '';
}
// Keep the replacement aligned with the code it replaces when the model added
// or dropped indentation on the continuation lines of a multi-line snippet.
// The first line is left alone: its indentation sits outside the match.
function alignAfter(after: string, before: string, matched: string) {
  if (!after) return after;
  const afterLines = after.split('\n');
  const beforeLines = before.split('\n');
  const matchedLines = matched.split('\n');
  if (
    afterLines.length < 2 ||
    beforeLines.length < 2 ||
    matchedLines.length < 2
  )
    return after;
  const given = indentOf(beforeLines[1]);
  const expected = indentOf(matchedLines[1]);
  if (given === expected) return after;
  const adjust = (line: string) => {
    if (!line.trim()) return line;
    if (expected.startsWith(given)) return expected.slice(given.length) + line;
    if (given.startsWith(expected)) {
      const drop = given.slice(expected.length);
      return line.startsWith(drop) ? line.slice(drop.length) : line;
    }
    return line;
  };
  return [afterLines[0], ...afterLines.slice(1).map(adjust)].join('\n');
}
function resolveEdit(
  code: string,
  parsed: SuggestedEdit,
  ranges: Range[],
): SuggestedEdit | null {
  const range = locate(code, parsed.before);
  if (!range) return null;
  if (ranges.some((r) => range.from < r.to && range.to > r.from)) return null;
  ranges.push(range);
  const matched = code.slice(range.from, range.to);
  return {
    before: matched,
    after: alignAfter(parsed.after, parsed.before, matched),
    explanation: parsed.explanation,
  };
}
function assemble(
  base: ReturnType<typeof contentOf>,
  edits: SuggestedEdit[],
): Walkthrough {
  return {
    title: base.title,
    explanation: base.explanation,
    hints: base.hints,
    steps: base.steps,
    solution: base.solution,
    edits,
  };
}
export function validateWalkthrough(value: unknown, code: string): Walkthrough {
  const base = contentOf(value);
  if (base.edits.length > MAX_EDITS) throw new Error('Too many edits');
  const ranges: Range[] = [];
  const edits = base.edits.map((item) => {
    const edit = resolveEdit(code, parseEdit(item), ranges);
    if (!edit) throw new Error('Edit does not uniquely match your code');
    return edit;
  });
  return assemble(base, edits);
}
// Like validateWalkthrough, but keeps the parts of a reply that do work: an
// edit that cannot be matched is dropped and counted instead of failing the
// whole response, so the candidate still gets the explanation and hints.
export function validateWalkthroughPartial(
  value: unknown,
  code: string,
): { walkthrough: Walkthrough; dropped: number } {
  const base = contentOf(value);
  const ranges: Range[] = [];
  const edits: SuggestedEdit[] = [];
  let dropped = Math.max(0, base.edits.length - MAX_EDITS);
  for (const item of base.edits.slice(0, MAX_EDITS)) {
    let parsed: SuggestedEdit;
    try {
      parsed = parseEdit(item);
    } catch {
      dropped++;
      continue;
    }
    const edit = resolveEdit(code, parsed, ranges);
    if (!edit) {
      dropped++;
      continue;
    }
    edits.push(edit);
  }
  return { walkthrough: assemble(base, edits), dropped };
}
export function acceptEdit(
  current: string,
  proposal: Proposal,
  index: number,
): { code: string; proposal: Proposal | null } {
  if (current !== proposal.base)
    throw new Error('Your code changed. Request a fresh suggestion.');
  const edit = proposal.edits[index];
  if (!edit) throw new Error('This edit is no longer available.');
  const start = current.indexOf(edit.before);
  if (start < 0 || current.indexOf(edit.before, start + 1) !== -1)
    throw new Error('This edit no longer matches uniquely.');
  const code =
    current.slice(0, start) +
    edit.after +
    current.slice(start + edit.before.length);
  const remaining = proposal.edits.filter((_, i) => i !== index);
  // Do not carry ambiguous changes forward after applying an edit.
  const safe = remaining.filter((e) => {
    const at = code.indexOf(e.before);
    return at >= 0 && code.indexOf(e.before, at + 1) === -1;
  });
  return { code, proposal: safe.length ? { base: code, edits: safe } : null };
}
