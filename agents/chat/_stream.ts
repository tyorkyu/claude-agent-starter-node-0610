import { query } from '@anthropic-ai/claude-agent-sdk';
import { redactBase64Deep } from '../_redact';

interface Logger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

interface CreateChatStreamOptions {
  message: string;
  options: Record<string, any>;
  signal?: AbortSignal;
  logger: Logger;
  conversationId: string;
  store: any;
  botMsgId?: string;
  userId?: string;
}

/** Skill catalog — describes skills available in this project. */
const PROJECT_SKILLS = [
  {
    name: 'sandbox-algorithms',
    label: 'Sandbox algorithm execution',
    description: 'Run deterministic algorithm scripts through the EdgeOne sandbox code_interpreter and return verified execution results.',
  },
];

function sseFrame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Extract short name from MCP tool full name (e.g. mcp__edgeone__commands → commands) */
function extractToolName(rawName: string): string {
  if (rawName.includes('__')) {
    return rawName.split('__').pop() || rawName;
  }
  return rawName;
}

/**
 * Redact base64Image from a value for safe logging/debug display.
 * Uses a cheap string check to skip expensive recursion on the hot path.
 */
function redactForPreview(value: unknown): unknown {
  // Fast path: skip recursion if raw JSON clearly has no base64Image
  const quick = typeof value === 'string' ? value : JSON.stringify(value);
  if (!quick?.includes('base64Image')) return value;
  return redactBase64Deep(value, '[REDACTED image data]');
}

function safeJsonPreview(value: unknown, maxLength = 800): string {
  try {
    const redacted = redactForPreview(value);
    const text = JSON.stringify(redacted);
    if (!text) return String(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...<truncated>` : text;
  } catch {
    return String(value);
  }
}

function enqueueSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: Record<string, unknown>,
): void {
  controller.enqueue(encoder.encode(sseFrame(event, data)));
}

function emitToolResultImages(
  msg: any,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  logger: Logger,
): void {
  try {
    const toolResults = msg.tool_use_result ?? msg.message?.content ?? [];
    const resultArr = Array.isArray(toolResults) ? toolResults : [toolResults];
    for (const item of resultArr) {
      // tool_use_result format: [{type: "text", text: "{\"base64Image\": \"...\"}"}]
      const text = typeof item === 'string' ? item : (item?.text ?? item?.content ?? '');
      if (typeof text === 'string' && text.includes('base64Image')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.base64Image) {
            const base64 = parsed.base64Image;
            const imageId = crypto.randomUUID();
            const mimeType = 'image/png';
            const size = base64.length;

            logger.log('[image] extracted base64Image from tool_result, imageId:', imageId, 'size:', size);

            // Emit enriched image event with metadata
            enqueueSse(controller, encoder, 'image', {
              imageId,
              base64,
              mimeType,
              size,
            });
          }
        } catch {
          // Not valid JSON, skip.
        }
      }
    }
  } catch (e) {
    logger.error('[image] failed to extract base64Image:', e);
  }
}

/**
 * Trace timer for diagnosing where time is spent inside `query()`.
 *
 * Emits two kinds of timestamps for every event:
 *   t = elapsed since query() began
 *   d = delta since last trace event (i.e. "how long was this gap?")
 *
 * Plus a per-tool-use clock (toolUse → tool_result) so we can pinpoint slow
 * tools (sandbox commands, code_interpreter, browser, etc.).
 *
 * Usage in chat logs (paste into your dev console / log aggregator):
 *   grep '\[trace\]'   → linear timeline
 *   grep 'tool='       → per-tool latency
 *   grep '\[trace\] summary' → final breakdown
 */
function createTraceTimer(logger: Logger, tag: string) {
  const startedAt = Date.now();
  let lastAt = startedAt;

  /** Cumulative time spent in each phase (rough categorization). */
  const phase = {
    sdkBoot: 0,        // query() start → first SDK message
    llmInfer: 0,       // last tool_result (or boot) → next assistant msg
    toolExec: 0,       // assistant w/ tool_use → corresponding tool_result
    other: 0,
  };

  /** Per-tool inflight tracker. Keyed by tool_use_id (block.id). */
  const toolInflight = new Map<string, { tool: string; startedAt: number }>();

  /** Per-tool aggregated stats. */
  const toolStats = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  /** What kind of work is currently running, used to attribute gap time. */
  let currentPhase: 'sdkBoot' | 'llmInfer' | 'toolExec' | 'other' = 'sdkBoot';

  function fmt(ms: number): string {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function event(label: string, extra?: Record<string, unknown>): void {
    const now = Date.now();
    const t = now - startedAt;
    const d = now - lastAt;
    lastAt = now;

    // Attribute the just-elapsed gap (`d`) to whichever phase we were in.
    phase[currentPhase] += d;

    const extraStr = extra && Object.keys(extra).length > 0
      ? ' ' + Object.entries(extra)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
      : '';
    logger.log(`[trace][${tag}] ${label} t=${fmt(t)} d=${fmt(d)}${extraStr}`);
  }

  function setPhase(p: typeof currentPhase): void {
    currentPhase = p;
  }

  function toolStarted(toolUseId: string | undefined, tool: string): void {
    if (!toolUseId) return;
    toolInflight.set(toolUseId, { tool, startedAt: Date.now() });
  }

  function toolFinished(toolUseId: string | undefined): void {
    if (!toolUseId) return;
    const inflight = toolInflight.get(toolUseId);
    if (!inflight) return;
    toolInflight.delete(toolUseId);
    const ms = Date.now() - inflight.startedAt;
    const cur = toolStats.get(inflight.tool) ?? { count: 0, totalMs: 0, maxMs: 0 };
    cur.count += 1;
    cur.totalMs += ms;
    if (ms > cur.maxMs) cur.maxMs = ms;
    toolStats.set(inflight.tool, cur);
    logger.log(`[trace][${tag}] tool_done tool=${inflight.tool} ms=${ms} t=${fmt(Date.now() - startedAt)}`);
  }

  function summary(): void {
    const totalMs = Date.now() - startedAt;
    const tools: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {};
    for (const [name, s] of toolStats) {
      tools[name] = {
        count: s.count,
        totalMs: s.totalMs,
        avgMs: Math.round(s.totalMs / s.count),
        maxMs: s.maxMs,
      };
    }
    logger.log(
      `[trace][${tag}] summary total=${fmt(totalMs)}`,
      'phases=' + JSON.stringify({
        sdkBoot:   `${(phase.sdkBoot / 1000).toFixed(2)}s`,
        llmInfer:  `${(phase.llmInfer / 1000).toFixed(2)}s`,
        toolExec:  `${(phase.toolExec / 1000).toFixed(2)}s`,
        other:     `${(phase.other / 1000).toFixed(2)}s`,
      }),
      'tools=' + JSON.stringify(tools),
    );
  }

  return { event, setPhase, toolStarted, toolFinished, summary };
}

function emitDebugMessage(
  msg: any,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): void {
  if (msg.type !== 'assistant' && msg.type !== 'result') {
    // Use redacted preview for debug messages to avoid base64 pollution
    enqueueSse(controller, encoder, 'debug_msg', {
      msgType: msg.type,
      preview: safeJsonPreview(msg, 4000),
    });
  }
}

function emitAssistantBlocks(
  msg: any,
  state: { sentTextLenByBlock: Map<number, number>; fullAssistantText: string },
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  logger: Logger,
  conversationId: string,
  trace?: ReturnType<typeof createTraceTimer>,
): void {
  const blocks = msg.message?.content ?? [];
  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];

    if (block.type === 'text') {
      const fullText = block.text || '';
      const alreadySent = state.sentTextLenByBlock.get(idx) ?? 0;
      if (fullText.length > alreadySent) {
        const delta = fullText.slice(alreadySent);
        state.sentTextLenByBlock.set(idx, fullText.length);
        state.fullAssistantText = fullText;
        enqueueSse(controller, encoder, 'text_delta', { delta });
      }
    } else if (block.type === 'tool_use') {
      const rawToolName = block.name || '';
      const toolName = extractToolName(rawToolName);
      const toolId = 'id' in block ? block.id : undefined;
      const toolInput = 'input' in block ? block.input : undefined;

      logger.log(
        '[tools] call requested',
        {
          cid: conversationId,
          blockIndex: idx,
          tool: toolName,
          rawTool: rawToolName,
          toolId,
          inputKeys: toolInput && typeof toolInput === 'object' ? Object.keys(toolInput) : [],
          inputPreview: safeJsonPreview(toolInput),
        },
      );

      // Trace: this assistant block requests a tool call. Start the timer for
      // it; we'll close it when the matching tool_result message arrives.
      trace?.toolStarted(typeof toolId === 'string' ? toolId : undefined, toolName);
      trace?.event('tool_use', { tool: toolName, idx, id: typeof toolId === 'string' ? toolId.slice(0, 8) : '-' });

      enqueueSse(controller, encoder, 'tool_called', { tool: toolName });

      // Detect skill loading. The Claude Agent SDK's built-in tool is named
      // `Skill` (capital S, current SDK) but `load_skill` exists as a legacy
      // alias / short name in some runtime versions. Match both, case-
      // insensitive on the suffix, so an SDK upgrade or rename doesn't
      // silently disable the skill UI.
      const isSkillTool =
        toolName === 'Skill' ||
        toolName === 'load_skill' ||
        rawToolName.includes('load_skill') ||
        rawToolName.endsWith('Skill');
      if (isSkillTool) {
        const skillName = toolInput && typeof toolInput === 'object'
          ? (toolInput as Record<string, unknown>).skill ?? (toolInput as Record<string, unknown>).name ?? (toolInput as Record<string, unknown>).skillName
          : undefined;
        if (typeof skillName === 'string') {
          enqueueSse(controller, encoder, 'skill_loaded', { name: skillName, status: 'loaded' });
        }
      }
    } else {
      // Other block types (e.g. image): push as debug_block event with redacted content.
      enqueueSse(controller, encoder, 'debug_block', {
        blockIndex: idx,
        blockType: block.type,
        block: safeJsonPreview(block, 4000),
      });
    }
  }
}

export function createChatStream({
  message,
  options,
  signal,
  logger,
  conversationId,
  store,
  botMsgId,
  userId,
}: CreateChatStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let stopped = false;
  const state = {
    fullAssistantText: '',
    sentTextLenByBlock: new Map<number, number>(),
  };

  // Tag traces with a short cid prefix so concurrent requests are easy to
  // separate in shared logs.
  const traceTag = conversationId ? conversationId.slice(0, 8) : 'no-cid';
  const trace = createTraceTimer(logger, traceTag);

  return new ReadableStream({
    async start(controller) {
      try {
        // Emit skills config event before query starts.
        enqueueSse(controller, encoder, 'skills_loaded', {
          skills: options.skills,
          settingSources: options.settingSources,
        });

        // Emit available skills catalog for frontend UI.
        enqueueSse(controller, encoder, 'skills_available', {
          skills: PROJECT_SKILLS,
        });

        const abortController = new AbortController();
        if (signal?.aborted) {
          abortController.abort();
        } else {
          signal?.addEventListener('abort', () => abortController.abort(), { once: true });
        }

        trace.event('query_begin');
        // Phase: from query() begin until first SDK message arrives.
        // This captures CLI subprocess fork + SDK initialization + first
        // round trip to the LLM gateway.
        trace.setPhase('sdkBoot');

        const q = query({
          prompt: message,
          options: { ...options, abortController },
        });
        let lastMsgType = '';
        let firstMsgSeen = false;

        for await (const msg of q) {
          if (signal?.aborted) { stopped = true; break; }

          // First SDK message: end of "sdkBoot" phase.
          if (!firstMsgSeen) {
            firstMsgSeen = true;
            trace.event('first_msg', { type: msg.type });
            trace.setPhase('llmInfer');
          }

          // New assistant message round detected: if previous was user (tool_result), reset counters.
          if (msg.type === 'assistant' && lastMsgType === 'user') {
            state.sentTextLenByBlock.clear();
          }

          // Trace per message type. The phase attribution below assumes the
          // common Claude conversation pattern:
          //   assistant(text|tool_use) → user(tool_result) → assistant(...) → result
          // user(tool_result) closes a toolExec window; assistant after a
          // user message opens a new llmInfer window.
          if (msg.type === 'system') {
            const subtype = (msg as { subtype?: string }).subtype;
            trace.event('system', { subtype });
          } else if (msg.type === 'assistant') {
            const blocks = (msg.message?.content ?? []) as Array<{ type?: string }>;
            const blockTypes = blocks.map(b => b.type ?? '?').join(',');
            trace.event('assistant', { blocks: blockTypes });
            // If this assistant turn requests tools, the next phase is toolExec;
            // otherwise it's just text and we stay in llmInfer until result.
            const hasToolUse = blocks.some(b => b.type === 'tool_use');
            if (hasToolUse) {
              trace.setPhase('toolExec');
            }
          } else if (msg.type === 'user') {
            // user-typed messages from the SDK are tool_result wrappers.
            // Match them to inflight tool_use ids so we can charge time per tool.
            // Cast through unknown because the SDK's ContentBlockParam[] type
            // is narrower than the dynamic shape we need to inspect at runtime.
            const rawContent = msg.message?.content ?? [];
            const content = (Array.isArray(rawContent) ? rawContent : []) as unknown as Array<Record<string, unknown>>;
            const toolResults = content.filter(c => c?.type === 'tool_result');
            for (const tr of toolResults) {
              const toolUseId = typeof tr.tool_use_id === 'string' ? tr.tool_use_id : undefined;
              trace.toolFinished(toolUseId);
            }
            trace.event('tool_result', { count: toolResults.length });
            // After tool result we go back into LLM inference for the next
            // assistant turn.
            trace.setPhase('llmInfer');
          }

          lastMsgType = msg.type;

          // Intercept base64Image from tool_result and push as image event to frontend.
          if (msg.type === 'user') {
            emitToolResultImages(msg, controller, encoder, logger);
          }

          // Debug: push all message types for frontend observability (base64 redacted).
          emitDebugMessage(msg, controller, encoder);

          if (msg.type === 'assistant') {
            emitAssistantBlocks(msg, state, controller, encoder, logger, conversationId, trace);
          } else if (msg.type === 'result') {
            trace.event('result');
            const sessionId = msg.session_id;
            if (typeof sessionId === 'string') {
              logger.log('[session] Claude SDK result session_id:', sessionId);
            }
            break;
          }
        }
      } catch (e: unknown) {
        const error = e as Error;
        if (error.name === 'AbortError' || signal?.aborted) {
          stopped = true;
          logger.log('[stream] aborted by user');
        } else {
          // DEBUG: dump the entire error so the dev-server console shows the
          // SDK's underlying cause (CLI exit code, gateway 4xx body, etc.) —
          // not just the surface "process exited with code 1" message.
          logger.error('[stream] error.name:', error.name);
          logger.error('[stream] error.message:', error.message);
          logger.error('[stream] error.stack:', error.stack);
          const cause = (error as { cause?: unknown }).cause;
          if (cause !== undefined) {
            logger.error('[stream] error.cause:', cause);
            try {
              logger.error('[stream] error.cause (JSON):', JSON.stringify(cause, null, 2));
            } catch {
              // cause not serializable — already dumped raw above.
            }
          }
          enqueueSse(controller, encoder, 'error', {
            message: String(error.message ?? e),
            name: error.name || 'Error',
            stack: error.stack,
            cause,
          });
        }
      } finally {
        // Save assistant response to store (with frontend-generated ID for history alignment).
        // Always save when botMsgId is provided, even if text is empty (image-only turns),
        // so that /history returns this message and frontend can merge images back by ID.
        if (store && conversationId && botMsgId) {
          const content = state.fullAssistantText.trim() || '[image]';
          try {
            const args: Record<string, unknown> = {
              conversationId, role: 'assistant', content, messageId: botMsgId,
            };
            if (userId) args.userId = userId;
            await store.appendMessage(args);
          }
          catch (e) { logger.error('[store] failed to save assistant response:', e); }
        } else if (store && conversationId && state.fullAssistantText.trim()) {
          // Legacy fallback: no botMsgId but has text content
          try {
            const args: Record<string, unknown> = {
              conversationId, role: 'assistant', content: state.fullAssistantText,
            };
            if (userId) args.userId = userId;
            await store.appendMessage(args);
          }
          catch (e) { logger.error('[store] failed to save assistant response:', e); }
        }

        // Final timing summary — single line that aggregates phases and
        // per-tool latency. Look for `[trace][...] summary` to find it.
        try { trace.summary(); } catch { /* logging must never throw */ }

        enqueueSse(controller, encoder, 'done', { stopped });
        controller.close();
      }
    },
    cancel() {
      logger.log('[stream] client disconnected');
    },
  });
}
