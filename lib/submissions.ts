export type RunResult = {
  output: string;
  error?: string;
  results: { name: string; passed: boolean; error?: string }[];
  durationMs?: number;
  timeout?: boolean;
};
export type Submission = {
  id: string;
  problemId: string;
  stage: string;
  code: string;
  at: string;
  result: RunResult;
};
// A failed group's `error` is a Python traceback. The exception on the final
// line separates a crash (the code raised) from a wrong answer (it returned
// the wrong result). An assertion failure is a wrong answer, not a crash.
function crashed(error?: string) {
  if (!error) return false;
  const last = error.trim().split('\n').pop() || '';
  const type = /^([A-Za-z_][A-Za-z0-9_.]*)\s*(?::|$)/.exec(last)?.[1];
  if (type) return !type.startsWith('Assertion');
  return error.includes('Traceback (most recent call last):');
}
export function verdict(result: RunResult): string {
  if (result.timeout) return 'Time Limit Exceeded';
  if (result.error || result.results.some((t) => !t.passed && crashed(t.error)))
    return 'Runtime Error';
  if (!result.results.length) return 'No test results';
  return result.results.every((t) => t.passed) ? 'Accepted' : 'Wrong Answer';
}
export function addSubmission(
  history: Submission[],
  item: Submission,
): Submission[] {
  // Bound browser storage while retaining recent attempts across problems.
  return [item, ...history].slice(0, 100);
}
export function readSubmissions(raw: string | null): Submission[] {
  const value: unknown = JSON.parse(raw || '[]');
  if (!Array.isArray(value)) throw new Error('Invalid submission history');
  return value
    .filter(
      (s): s is Submission =>
        !!s &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.problemId === 'string' &&
        ['base', 'followup'].includes(s.stage) &&
        typeof s.code === 'string' &&
        s.code.length <= 100000 &&
        typeof s.at === 'string' &&
        Number.isFinite(Date.parse(s.at)) &&
        s.result &&
        typeof s.result.output === 'string' &&
        (s.result.error === undefined || typeof s.result.error === 'string') &&
        (s.result.durationMs === undefined ||
          (typeof s.result.durationMs === 'number' &&
            Number.isFinite(s.result.durationMs) &&
            s.result.durationMs >= 0)) &&
        (s.result.timeout === undefined ||
          typeof s.result.timeout === 'boolean') &&
        Array.isArray(s.result.results) &&
        s.result.results.every(
          (t: { name?: unknown; passed?: unknown; error?: unknown }) =>
            t &&
            typeof t.name === 'string' &&
            typeof t.passed === 'boolean' &&
            (t.error === undefined || typeof t.error === 'string'),
        ),
    )
    .slice(0, 100);
}
