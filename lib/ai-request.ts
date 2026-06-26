/**
 * Shared request handling for the AI endpoints: same-origin check, bearer
 * credential, JSON body, and a hard cap on the bytes actually read rather
 * than on a declared length.
 */
const MAX_BODY = 100_000;

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

type Failure = { response: Response };

/** A rejected request, carrying the response to send back verbatim. */
export function reject(data: unknown, status: number): Failure {
  return { response: json(data, status) };
}

export function isFailure(value: unknown): value is Failure {
  return (
    !!value &&
    typeof value === 'object' &&
    'response' in value &&
    (value as Failure).response instanceof Response
  );
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw reject({ error: 'Missing request.' }, 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw reject(
        {
          error:
            'Your request is too long. Shorten the text and start a new conversation.',
        },
        413,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export type Guarded = {
  authorization: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
};

/**
 * Runs every shared precondition and returns the parsed body, or throws a
 * `Failure` that the caller should return directly.
 */
export async function guard(
  request: Request,
  check: (body: unknown) => string | null,
): Promise<Guarded> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw reject(
      { error: 'This request must come from the practice app.' },
      403,
    );
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [\x21-\x7E]{8,512}$/.test(authorization))
    throw reject(
      { error: 'Add a valid DeepSeek API key in AI settings.' },
      401,
    );
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw reject({ error: 'Expected a JSON request.' }, 415);
  let body: unknown;
  try {
    body = await readBody(request);
  } catch (e) {
    if (isFailure(e)) throw e;
    throw reject({ error: 'Invalid JSON request.' }, 400);
  }
  const problem = check(body);
  if (problem) throw reject({ error: problem }, 400);
  return {
    authorization,
    body: body as Record<string, unknown>,
    signal: request.signal,
  };
}

/** Signals an upstream failure the candidate should be told about. */
export class Upstream extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'Upstream';
    this.status = status;
  }
}

/** One call to the model, with the shared error mapping and cancellation. */
export async function callModel(options: {
  fetcher: typeof fetch;
  authorization: string;
  signal: AbortSignal;
  system: string;
  messages: { role: string; content: string }[];
  maxTokens: number;
  timeoutMs?: number;
  json?: boolean;
}): Promise<string> {
  const response = await options.fetcher(
    'https://api.deepseek.com/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: options.authorization,
      },
      signal: AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 60000),
      ]),
      body: JSON.stringify({
        model: 'deepseek-flash',
        stream: false,
        max_tokens: options.maxTokens,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: options.system },
          ...options.messages,
        ],
      }),
    },
  );
  if (!response.ok) {
    const errors: Record<number, string> = {
      401: 'DeepSeek rejected this key. Check it in AI settings.',
      402: 'Your DeepSeek account needs credit.',
      429: 'DeepSeek is rate limited. Wait a moment and try again.',
    };
    throw new Upstream(
      [401, 402, 429].includes(response.status) ? response.status : 502,
      errors[response.status] ||
        'DeepSeek is unavailable right now. Please try again.',
    );
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim())
    throw new Upstream(
      502,
      'DeepSeek returned an empty reply. Please try again.',
    );
  return content;
}

export const isUpstream = (error: unknown): error is Upstream =>
  error instanceof Upstream;

/** The message for a failure that is not an upstream problem. */
export function transportMessage(error: unknown): string {
  return error instanceof Error &&
    ['TimeoutError', 'AbortError'].includes(error.name)
    ? 'The request was cancelled or timed out. You can try again.'
    : 'Could not reach DeepSeek. Check your connection and try again.';
}
