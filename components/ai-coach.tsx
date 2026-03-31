'use client';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Bot, Send, Square, X, RotateCcw, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormattedText } from '@/components/formatted-text';
import type { Proposal, Walkthrough } from '@/lib/review';
export type CoachHandle = {
  ask: (
    mode: string,
    question?: string,
    override?: { context: string; code: string },
  ) => void;
};
type Message = {
  role: 'user' | 'assistant';
  content: string;
  walkthrough?: Walkthrough;
  droppedEdits?: number;
  source?: string;
};
const prompts: Record<string, string> = {
  review:
    'Review my current approach and code. Report only real problems, ordered by impact.',
  debug:
    'Suggest a minimal fix for this failure. Walk through my code step by step, explain what goes wrong, and propose edits I can review.',
  hint: 'Help me from where I am in my code. Give three progressive hints, a step-by-step walkthrough, and proposed edits I can choose to apply.',
  complexity:
    'Give the time and space complexity of this exact code, name the dominant term, and list only changes that improve the complexity or give a clear constant-factor win.',
  explain:
    'Explain this problem with a concrete example, in plain language, without revealing the implementation.',
  approach:
    'Describe the approach and the key invariant, without writing the full solution.',
};
const working: Record<string, string> = {
  review: 'Reviewing your code',
  debug: 'Finding the cause',
  hint: 'Working out a hint',
  explain: 'Explaining the problem',
  approach: 'Sketching an approach',
  complexity: 'Analysing complexity',
};
const designPrompts: Record<string, string> = {
  review:
    'Review my current system design and follow-up reasoning. Check the scenario requirements, consistency and failure guarantees. Prioritize the most consequential gap and ask one focused question without giving the reference answer.',
  complexity:
    'Check my scale estimates. Verify units and arithmetic, identify the first bottleneck, and ask me for any missing assumptions rather than inventing them.',
  debug:
    'Stress-test my architecture with one plausible failure from this scenario. Ask how the user-visible behavior, retries and recovery work without writing the full solution.',
  hint: 'Give me a small hint about the most important gap in my system design reasoning. Do not reveal the full design.',
  explain:
    'Clarify this system design scenario and its requirements with a concrete example, without revealing a solution.',
  approach:
    'Help me structure an interview answer for this scenario. Start with requirements and assumptions, then suggest which decision to explain next without writing the full solution.',
};
export const AICoach = forwardRef<
  CoachHandle,
  {
    apiKey: string;
    context: string;
    code?: string;
    mock: boolean;
    onSettings: () => void;
    onClose: () => void;
    onProposal: (p: Proposal) => void;
  }
>(function AICoach(
  { apiKey, context, code, mock, onSettings, onClose, onProposal },
  ref,
) {
  const design = code === undefined;
  const suggestions = design ? designPrompts : prompts;
  const [messages, setMessages] = useState<Message[]>([]),
    [question, setQuestion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [mode, setMode] = useState('review'),
    [retry, setRetry] = useState('');
  const active = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (mock) active.current?.abort();
  }, [mock]);
  useEffect(() => {
    active.current?.abort();
  }, [apiKey]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, busy]);
  async function ask(
    nextMode: string,
    content = suggestions[nextMode] || suggestions.review,
    override?: { context: string; code: string },
  ) {
    if (busy || mock) return;
    if (!apiKey) {
      onSettings();
      return;
    }
    const next: Message[] = [...messages, { role: 'user', content }];
    if (next.length > 11) {
      setError('Start a new conversation to continue.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    // Show the question straight away. Waiting for the reply left the panel
    // looking empty for the whole request, and a failed request threw the
    // question away along with the error.
    setMessages(next);
    setQuestion('');
    setBusy(true);
    setError('');
    setMode(nextMode);
    const source = override?.code ?? code;
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          mode: nextMode,
          context: override?.context ?? context,
          code: source,
          messages: next.map((m) => ({
            role: m.role,
            // Replay what the coach actually said, so a follow-up can refer
            // to it. The solution stays out: it is still hidden in the UI.
            content: m.walkthrough
              ? [
                  m.walkthrough.title,
                  m.walkthrough.explanation,
                  m.walkthrough.hints.join('\n'),
                  m.walkthrough.steps.join('\n'),
                ].join('\n')
              : m.content,
          })),
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        error?: string;
        content: string;
        walkthrough?: Walkthrough;
        droppedEdits?: number;
      };
      if (!response.ok)
        throw new Error(data.error || 'Could not get feedback. Try again.');
      if (controller.signal.aborted) return;
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: data.content,
          walkthrough: data.walkthrough,
          droppedEdits: data.droppedEdits,
          source,
        },
      ]);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Could not get feedback.');
    } finally {
      if (active.current === controller) {
        // Stopping means the question was never really asked, so take it back
        // out. A failed request keeps it: the candidate should not have to
        // retype a question the coach never saw.
        if (controller.signal.aborted) setMessages(messages);
        active.current = null;
        setBusy(false);
      }
    }
  }
  useImperativeHandle(ref, () => ({ ask }));
  const status =
    design && mode === 'review'
      ? 'Reviewing your design'
      : design && mode === 'complexity'
        ? 'Checking your estimates'
        : working[mode] || 'Thinking';
  return (
    <section className="coach-panel" aria-label="AI coach">
      <div className="pane-toolbar">
        <Bot size={16} />
        <b>Lab Coach</b>
        <small>DeepSeek V4.1 Flash</small>
        <Button
          variant="ghost"
          aria-label="New conversation"
          disabled={busy}
          onClick={() => {
            setMessages([]);
            setError('');
          }}
        >
          <RotateCcw size={14} />
        </Button>
        <Button variant="ghost" aria-label="Close AI coach" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      {mock ? (
        <p className="coach-empty">
          Coaching is paused in mock mode. Turn it off to get feedback.
        </p>
      ) : (
        <>
          <div className="coach-scroll" ref={scroll}>
            {!messages.length && !busy && (
              <div className="coach-welcome">
                <div className="bot-symbol">
                  <Bot size={28} />
                </div>
                <h3>
                  {design ? 'Your design coach' : 'Your coding companion'}
                </h3>
                <p>
                  {design
                    ? 'Use section reviews for scoring. Ask here to clarify requirements, check estimates, or work through a design decision.'
                    : 'Start with your approach. Work through the details together.'}
                </p>
                {(design
                  ? ['review', 'complexity', 'debug']
                  : ['explain', 'approach', 'complexity']
                ).map((m, i) => (
                  <Button key={m} variant="outline" onClick={() => ask(m)}>
                    {
                      (design
                        ? [
                            'Review my design',
                            'Check my estimates',
                            'Test a failure',
                          ]
                        : [
                            'Explain this problem',
                            'Suggest an approach',
                            'Time & space complexity',
                          ])[i]
                    }
                  </Button>
                ))}
                <small>
                  {design
                    ? 'Your scenario, written answers and submitted follow-ups are sent to DeepSeek when you ask.'
                    : 'Your work and test results are sent to DeepSeek when you ask.'}
                  API usage is billed to your saved key.
                </small>
              </div>
            )}
            <div aria-live="polite">
              {messages.map((m, i) => (
                <div key={i} className={`coach-message ${m.role}`}>
                  <b>{m.role === 'user' ? 'You' : 'Lab Coach'}</b>
                  {m.walkthrough ? (
                    <>
                      <h3>
                        <Lightbulb size={17} /> {m.walkthrough.title}
                      </h3>
                      <FormattedText text={m.walkthrough.explanation} />
                      {m.walkthrough.hints.map((hint, n) => (
                        <details
                          className={`progressive-hint hint-${n}`}
                          key={n}
                          open={n === 0}
                        >
                          <summary>
                            Hint {n + 1}
                            <span>Click to reveal</span>
                          </summary>
                          <FormattedText text={hint} />
                        </details>
                      ))}
                      <details>
                        <summary>Step-by-step walkthrough</summary>
                        <ol>
                          {m.walkthrough.steps.map((step, n) => (
                            <li key={n}>
                              <FormattedText text={step} />
                            </li>
                          ))}
                        </ol>
                      </details>
                      <details>
                        <summary>
                          Solution <small>(reveals the answer)</small>
                        </summary>
                        <FormattedText text={m.walkthrough.solution} />
                      </details>
                      <details>
                        <summary>
                          Suggested code edits{' '}
                          <small>
                            {m.droppedEdits
                              ? `${m.walkthrough.edits.length} of ${
                                  m.walkthrough.edits.length + m.droppedEdits
                                } matched your code`
                              : `${m.walkthrough.edits.length} changes`}
                          </small>
                        </summary>
                        {m.walkthrough.edits.length ? (
                          <>
                            {!!m.droppedEdits && (
                              <p className="edit-notice">
                                {m.droppedEdits} suggested{' '}
                                {m.droppedEdits === 1 ? 'change' : 'changes'}{' '}
                                could not be matched to your current code and{' '}
                                {m.droppedEdits === 1 ? 'was' : 'were'} left
                                out.
                              </p>
                            )}
                            <p>
                              Preview the red and green changes in your editor.
                              Accept or reject each change there.
                            </p>
                            <Button
                              onClick={() =>
                                onProposal({
                                  base: m.source || '',
                                  edits: m.walkthrough!.edits,
                                })
                              }
                            >
                              Review edits in editor
                            </Button>
                          </>
                        ) : m.droppedEdits ? (
                          <p className="edit-notice">
                            DeepSeek&rsquo;s suggested changes did not line up
                            with your current code, so there is nothing to
                            apply. The explanation above still applies; ask
                            again for a fresh attempt.
                          </p>
                        ) : (
                          <p>No code changes suggested.</p>
                        )}
                      </details>
                    </>
                  ) : (
                    <FormattedText text={m.content} />
                  )}
                </div>
              ))}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {busy && (
              <div className="coach-message assistant coach-thinking">
                <b>Lab Coach</b>
                <output className="coach-working" aria-live="polite">
                  <span className="coach-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {status}
                </output>
                <Button
                  variant="outline"
                  onClick={() => active.current?.abort()}
                >
                  <Square /> Stop
                </Button>
              </div>
            )}
            {messages.some((m) => m.role === 'assistant') && (
              <details className="retry-hints">
                <summary>Retry with instructions</summary>
                <textarea
                  aria-label="Hint instructions"
                  placeholder={
                    design
                      ? 'Focus on the consistency boundary…'
                      : 'Focus on the loop invariant…'
                  }
                  value={retry}
                  onChange={(e) => setRetry(e.target.value)}
                  maxLength={2000}
                />
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    ask(
                      mode,
                      `${prompts[mode]}\nAdditional instructions: ${retry}`,
                    )
                  }
                >
                  <RotateCcw /> Retry
                </Button>
              </details>
            )}
          </div>
          <form
            className="coach-compose"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) void ask('review', question.trim());
            }}
          >
            <div className="coach-compose-row">
              <textarea
                aria-label="Ask your coach"
                placeholder={
                  design
                    ? 'Ask about a design decision…'
                    : 'Ask about your code…'
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter keeps the newline people expect.
                  if (
                    e.key !== 'Enter' ||
                    e.shiftKey ||
                    e.nativeEvent.isComposing
                  )
                    return;
                  e.preventDefault();
                  if (question.trim() && !busy)
                    void ask('review', question.trim());
                }}
                maxLength={12000}
                disabled={busy}
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                disabled={busy || !question.trim()}
              >
                <Send size={16} />
              </Button>
            </div>
            <small className="coach-compose-hint">
              Enter to send · Shift+Enter for a new line
            </small>
          </form>
        </>
      )}
    </section>
  );
});
