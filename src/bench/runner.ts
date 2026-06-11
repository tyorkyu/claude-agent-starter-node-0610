/**
 * Sandbox 并发测试运行器
 *
 * 设计要点：
 * - 每个任务使用独立的 makers-conversation-id（即一个独立 sandbox）。
 * - prompt 强制让 Agent 走 sandbox 的 code_interpreter，
 *   通过 time.sleep 占用 sandbox，使并发窗口足够长，便于触发 20 并发上限。
 * - 全程不依赖 store / history / stop 等接口，直接打 /chat SSE。
 * - 把每个任务的 SSE raw event 全留下来，方便观察平台返回的限流/排队语义。
 */

export type TaskStatus =
  | 'pending'
  | 'connecting'
  | 'running'
  | 'success'
  | 'rate_limited'
  | 'error'
  | 'aborted';

export interface TaskRawEvent {
  ts: number;
  event: string;
  data: string; // 截断后的 raw json
}

export interface TaskRecord {
  index: number;
  conversationId: string;
  status: TaskStatus;
  httpStatus?: number;
  /** Platform-side request id surfaced via response headers (for cross-checking function logs). */
  requestId?: string;
  startedAt: number;
  firstByteAt?: number;
  endedAt?: number;
  toolCalls: string[];
  errorMessage?: string;
  errorRaw?: string;
  textPreview: string;
  rawEvents: TaskRawEvent[];
  /** True only when a SSE `done` event was actually received. */
  doneReceived: boolean;
}

export interface RunnerCallbacks {
  onTaskUpdate: (task: TaskRecord) => void;
}

const MAX_RAW_EVENTS_PER_TASK = 60;

const RATE_LIMIT_KEYWORDS = [
  'rate limit',
  'rate_limit',
  'too many',
  'concurrent',
  'concurrency',
  'quota',
  'limit exceeded',
  'sandbox limit',
  'sandbox_limit',
  'no available sandbox',
  'sandbox unavailable',
  'sandbox_unavailable',
  'busy',
  'queue full',
  '429',
];

function looksLikeRateLimit(text: string): boolean {
  const lower = text.toLowerCase();
  return RATE_LIMIT_KEYWORDS.some((k) => lower.includes(k));
}

function pushRaw(task: TaskRecord, event: string, data: string): void {
  if (task.rawEvents.length >= MAX_RAW_EVENTS_PER_TASK) return;
  task.rawEvents.push({
    ts: Date.now(),
    event,
    data: data.length > 600 ? `${data.slice(0, 600)}...<truncated>` : data,
  });
}

/** Run a single conversation: open SSE, parse events, finalize task status. */
export async function runSingleTask(
  task: TaskRecord,
  prompt: string,
  callbacks: RunnerCallbacks,
  signal: AbortSignal,
): Promise<void> {
  task.status = 'connecting';
  callbacks.onTaskUpdate(task);

  let res: Response;
  try {
    res = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'makers-conversation-id': task.conversationId,
      },
      body: JSON.stringify({
        message: prompt,
        userMsgId: `bench-u-${task.conversationId}`,
        botMsgId: `bench-b-${task.conversationId}`,
      }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) {
      task.status = 'aborted';
    } else {
      task.status = 'error';
      task.errorMessage = e instanceof Error ? e.message : String(e);
    }
    task.endedAt = Date.now();
    callbacks.onTaskUpdate(task);
    return;
  }

  task.httpStatus = res.status;
  task.firstByteAt = Date.now();
  // Capture the platform request id so we can pivot from a "frontend success"
  // to the actual cloud-function invocation logs (multiple invocations may
  // back one fetch due to OOM-driven internal retries).
  task.requestId =
    res.headers.get('x-request-id') ||
    res.headers.get('x-tencent-request-id') ||
    res.headers.get('x-trace-id') ||
    res.headers.get('request-id') ||
    undefined;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    task.endedAt = Date.now();
    task.errorMessage = `HTTP ${res.status}`;
    task.errorRaw = body.slice(0, 800);
    if (res.status === 429 || looksLikeRateLimit(body)) {
      task.status = 'rate_limited';
    } else {
      task.status = 'error';
    }
    pushRaw(task, 'http_error', `${res.status} ${body.slice(0, 400)}`);
    callbacks.onTaskUpdate(task);
    return;
  }

  task.status = 'running';
  callbacks.onTaskUpdate(task);

  const reader = res.body?.getReader();
  if (!reader) {
    task.status = 'error';
    task.errorMessage = 'ReadableStream not supported';
    task.endedAt = Date.now();
    callbacks.onTaskUpdate(task);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;
        let eventType = '';
        let data = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) eventType = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (!eventType) continue;

        pushRaw(task, eventType, data);

        if (eventType === 'text_delta') {
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed.delta === 'string') {
              task.textPreview = (task.textPreview + parsed.delta).slice(-600);
            }
          } catch { /* ignore */ }
        } else if (eventType === 'tool_called') {
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed.tool === 'string') {
              task.toolCalls.push(parsed.tool);
            }
          } catch { /* ignore */ }
        } else if (eventType === 'error') {
          task.errorRaw = data;
          let parsedMsg = '';
          try {
            const parsed = JSON.parse(data);
            parsedMsg = String(parsed.message ?? '');
          } catch { parsedMsg = data; }
          task.errorMessage = parsedMsg || 'agent error';
          if (looksLikeRateLimit(parsedMsg) || looksLikeRateLimit(data)) {
            task.status = 'rate_limited';
          } else {
            task.status = 'error';
          }
        } else if (eventType === 'done') {
          task.doneReceived = true;
          // success only when not previously marked as error/rate_limited
          if (task.status === 'running') {
            task.status = 'success';
          }
        }

        callbacks.onTaskUpdate(task);
      }
    }
  } catch (e) {
    if (signal.aborted) {
      task.status = 'aborted';
    } else if (task.status === 'running') {
      task.status = 'error';
      task.errorMessage = e instanceof Error ? e.message : String(e);
    }
  } finally {
    task.endedAt = Date.now();
    // Strict success contract: only count as success when the SSE `done` event
    // was actually received. Otherwise the stream was cut mid-flight (likely
    // upstream OOM / instance recycle / proxy timeout) — surface it as an
    // error so the bench numbers match the cloud-function failure metrics.
    //
    // Cast through TaskStatus to avoid TS narrowing the union to just the
    // failure subset by the time control flow reaches `finally`.
    if (!task.doneReceived) {
      const finalStatus: TaskStatus = task.status;
      if (finalStatus !== 'error' && finalStatus !== 'rate_limited' && finalStatus !== 'aborted') {
        task.status = 'error';
        task.errorMessage = task.errorMessage || 'stream closed without done event';
      }
    }
    callbacks.onTaskUpdate(task);
  }
}

/**
 * Pool-based concurrency limiter.
 *
 * Why this exists: HTTP/1.1 caps a single origin at ~6 concurrent connections
 * per browser. Without throttling, the bench fires N fetches at once, the
 * first 6 actually leave the browser, and the rest sit in the browser-side
 * pending queue with no visibility — the platform never sees them, so any
 * sandbox / function metric we collect is wrong by construction.
 *
 * `runWithLimit` keeps at most `inFlightLimit` tasks in flight; as soon as
 * one task settles (success / error / rate_limited / aborted) the next pending
 * task is started. Tasks remain in pool order so the bench's `index` keeps
 * matching the order in the table.
 *
 * The function resolves once every task has reached a terminal state.
 */
export async function runWithLimit(
  tasks: TaskRecord[],
  prompt: string,
  callbacks: RunnerCallbacks,
  signal: AbortSignal,
  inFlightLimit: number,
): Promise<void> {
  const limit = Math.max(1, Math.floor(inFlightLimit));
  let cursor = 0;

  async function worker(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted) return;
      const next = cursor++;
      if (next >= tasks.length) return;
      const task = tasks[next];
      task.startedAt = Date.now();
      try {
        await runSingleTask(task, prompt, callbacks, signal);
      } catch {
        // runSingleTask handles its own errors; defensive guard so one
        // failing task can't take down the worker loop.
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
