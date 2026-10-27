# AGENTS.md

Backend interview practice app: 29 Python coding problems + 29 follow-up
labs, 18 system-design scenarios, and a DeepSeek coach. No server database —
all progress lives in the browser.

## Toolchain surprise
This looks like Next.js (`app/`, `next.config.ts`, `next-env.d.ts`) but `next` is
**not** a dependency. It runs on **vinext** (Next-on-Vite) + `@cloudflare/vite-plugin`
+ `wrangler`. Build output is `dist/client` + `dist/server`, not `.next`.
`next-env.d.ts` is generated and imports `.next/types/routes.d.ts`, so run
`npm run dev` or `npm run build` once on a fresh checkout before `npm run typecheck`.

## Commands
Node >= 22.13.0 required (`--experimental-strip-types` is used). GitHub CI runs unit/runtime, lint, build, styles, type checks, and isolated browser regressions. Run the relevant local checks before committing.

- `npm run dev` — vinext/Vite dev server (also `Start Interview Lab.command`).
- `npm run build` — production build into `dist/`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — `test:unit` + `test:runtime`.
- `npm run test:unit` — `node --experimental-strip-types --test tests/*.test.mjs`
  (plain `node:test`, no jest/vitest). `app.test.mjs` covers the coach and drafts,
  `design.test.mjs` covers the section grader and the design draft schema.
- `npm run test:runtime` — runs `public/runner.py` under Node Pyodide; validates
  every reference solution, starter, and formatted example.
- `npm run test:coverage` — coverage of `lib/*.ts` only, not whole-app.
- `npm run test:styles` — **must run after `npm run build`**; checks built CSS.
- `npm run test:browser` — Python Playwright against an already-running
  `npm run dev`. Setup is in README; `LAB_URL` overrides the URL and
  `LAB_BROWSER_CHANNEL=chrome` uses installed Chrome. Each test gets a fresh
  browser context.
- `npm run lint` — oxlint (type-aware via tsgolint); `npm run format` — oxfmt.

## Architecture
- `app/page.tsx` — client shell: library, settings, and localStorage state.
- `components/practice-workspace.tsx` — main editor/runner/coach UI (largest file).
- `components/design-interview.tsx` — the system design track: section flow,
  grading, follow-ups, report and reference answers. Kept out of
  `practice-workspace.tsx` on purpose; do not fold it back in.
- The design Question tab carries the things you practise against: assumptions,
  the per-section rubric, the follow-up questions the interviewer will ask, and
  the failure drills. The Solution tab carries the answers: a reference answer
  per section, a worked answer per follow-up, and the expected response per
  failure. Nothing on the Solution tab is shown during a mock, but the
  questions are, because a question is not an answer.
- `app/api/coach/route.ts` → `lib/coach.ts:handleCoach`, and
  `app/api/design/route.ts` → `lib/design-grader.ts:handleDesign`. Both are pure
  functions with an injectable `fetcher`, which is how tests mock DeepSeek. Fixed
  endpoint and fixed model `deepseek-flash`. Keys are forwarded per request only —
  never stored or logged.
- `lib/ai-request.ts` — the preconditions both AI endpoints share (same-origin,
  bearer key, JSON body, a cap on bytes actually read). Do not re-implement these
  per route. Note the validator parameter is named `check`, not `require`: the
  bundler fails the build on a bare `require(...)` call.
- `lib/design.ts` — the six system design sections, the draft types, and the
  scoring. Progress and score are deliberately independent: a section is finished
  when the grader runs out of questions, which is not the same as scoring well.
- `lib/review.ts` — matches model-suggested edits to the candidate's code (exact
  then whitespace-flexible unique match), drops unmatched edits, and rejects stale
  proposals in `acceptEdit`.
- Python runs only in the browser: Worker `public/python-worker.js` + runner
  `public/runner.py` + Pyodide 0.29.2 vendored in `public/python/`. There is no
  server-side arbitrary-code endpoint.
- `tests/runtime.mjs` loads the same `public/runner.py` under Node — keep runner
  behavior in sync with the browser worker.

## Data files must be edited together
`tests/runtime.mjs` enforces cross-file invariants, so a problem edit usually spans
several files:

- `app/data/coding.json` — base problems: `starter`, `solution`, `tests`, `followups`.
- `app/data/followups.json` — follow-up labs keyed by the same `id`, with
  `starter`/`solution`/`tests`/`answers`.
- `app/data/problem-content.json` — formatted content keyed `"<id>"` and `"<id>:followup"`.
- `app/data/design.json` — design scenarios: `rubric` (3 `expects` per section),
  plus `probes` and `failures` carrying the `section` they belong to.
- `app/data/design-answers.json` — the solution half: a `references` entry per
  section, plus the probe and failure answers. Keep both files in step.

Edit data with `node scripts/edit-content.mjs <file> <patch.json>
[--escape-non-ascii]`. The flag is required for the design files, which store
non-ASCII as `\uXXXX`; a `null` value removes a field. That script only patches
**existing** ids, so adding a problem means appending to the JSON array and
rewriting the file as `JSON.stringify(data, null, 2)` plus a trailing newline.
Two conventions the serialiser alone will not restore: `design.json` and
`design-answers.json` store non-ASCII as `\uXXXX` escapes and must stay pure
ASCII on disk, while the other three keep `→` and `×` literal. Run
`npx oxfmt app/data/` afterwards, or the arrays drift from the repo's wrapping.

Content scale is a real constraint, not a style preference. A `statement` runs
320-700 characters and a `solution` stays under ~240 lines; anything longer
belongs in `problem-content.json`'s `requirements`, which is the long-form home
for the rules. If a problem needs a big engine, split it across the base
problem and its follow-up lab rather than shipping one 350-line answer.

Invariants checked: every solution passes all its test groups; every unfinished
starter fails at least one; every base follow-up question has a matching in-order
answer; design probes/failures align **in order**; every scenario has one rubric
per section in `DESIGN_SECTIONS` order with 3 expectations each; every section tag
is a real section; every section has a reference answer; `focus` is gone; and
every example output in `problem-content.json` matches real Pyodide execution.

Reordering probes or failures in `design.json` breaks the answer alignment. Add a
tag instead of moving an entry.

## Conventions
- TypeScript `strict`, path alias `@/*` → repo root.
- Tailwind v4 is config-less: theme and sources live in `app/globals.css`
  (`@theme`, `@source`). No `tailwind.config`.
- shadcn/ui (`base-nova`) components live in `components/ui`; reuse them.
- oxlint errors on `typescript/no-explicit-any`, `ban-ts-comment`,
  `react/react-compiler`, etc. Disable narrowly with `/* oxlint-disable ... */`
  plus a reason where justified (see `app/page.tsx`).
- oxfmt: single quotes, 80 columns.
- Model markdown is rendered with `react-markdown` + `remark-gfm`; never raw HTML.
- Browser state keys: `interview-lab-v1` (drafts), `interview-lab-submissions-v1`
  (last 100 submissions), `interview-lab-deepseek-key`,
  `interview-lab-autocomplete`. Exports exclude the key.
- The completion popup is off by default and toggled from the editor toolbar,
  stored in `interview-lab-autocomplete`. It is the *only* thing the toggle
  governs: closing brackets and quotes is unconditional and set explicitly in
  the `basicSetup` object rather than left to the wrapper's default, so the two
  cannot drift apart. Do not re-tie bracket closing to the toggle.
- `app/layout.tsx` carries a small blocking script that runs before the first
  paint. A `useEffect` cannot: the server does not know which problem the URL
  names, so it renders the library, and the stored theme is read after paint.
  The script applies the theme and sets `data-boot`, which hides the library
  until React swaps in the workspace. Do not move either of those reads into
  an effect, or the flash comes back.
- Where the candidate is lives in the query string, not component state, so a
  refresh keeps them in place and a link opens a problem. `lib/view-state.ts` is
  the pure parser/serialiser; `app/page.tsx` mirrors state to the URL with the
  raw History API rather than the router, because a router navigation remounts
  the workspace and would tear down the editor and abort requests in flight.
  Opening a problem pushes a history entry; typing in a filter replaces.
