/**
 * Agent handler — EdgeOne Makers
 * ========================================
 *
 * File path agents/chat/index.ts maps to **POST /chat**
 *
 * context convention:
 *   context.request.body    — object, request body
 *   context.request.signal  — AbortSignal, set when /stop is called
 *   context.conversation_id — conversation ID
 *   context.store           — store adapter (appendMessage / getMessages / claudeSessionStore)
 *   context.tools           — EdgeOne platform sandbox toolkit
 */

import { createSdkMcpServer, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { resolveModelName, collectGatewayEnv } from '../_model';
import { createLogger } from '../_logger';
import { createChatStream } from './_stream';

const logger = createLogger('chat');

const SYSTEM_PROMPT =
  'You are an EdgeOne Makers Claude Agent SDK starter example: an out-of-the-box Agent template that helps developers quickly run through and validate platform capabilities.\n' +
  'When introducing yourself, clearly say that you are a demo Agent built with Claude Agent SDK on EdgeOne Makers, designed to showcase tool calling, streaming responses, and session memory for developers.\n' +
  'You can use the EdgeOne platform tools listed below, plus project skills exposed by the Claude Agent SDK.\n\n' +
  'Available tools:\n' +
  '- commands: execute safe shell commands in the sandbox (e.g. date, ls, uname).\n' +
  '- files: read, write, list, makeDir, exists, and remove files inside the sandbox.\n' +
  '  Parameters: op is required; path is required for most ops; content is required for write.\n' +
  '- code_interpreter: run code in an isolated interpreter.\n' +
  '  Parameters: language (for example "python") and code.\n' +
  '- browser: fetch pages or interact with web pages by screenshot, click, type, or evaluate.\n' +
  '  Parameters: op is required; use url for fetch; use selector, text, or script when needed.\n\n' +
  'Available project skills:\n' +
  '- sandbox-algorithms: use this when the user asks to compute or verify deterministic algorithmic results such as Fibonacci sequences, factorials, primes, sorting, combinations, or explicitly asks for sandbox-algorithms.\n\n' +
  'Tool-use rules:\n' +
  '1. Use a tool only when it is necessary to answer the user concretely or demonstrate a platform capability.\n' +
  '2. Call tools one at a time and wait for each result before deciding the next step.\n' +
  '3. Never invent, simulate, or paraphrase tool results. If a tool result is unavailable, say so.\n' +
  '4. If a tool call fails, do not repeat it blindly and do not switch to unrelated operations.\n' +
  '   Briefly explain the failure, adjust the parameters only if the fix is clear, otherwise ask the user for guidance.\n' +
  '5. Do not perform destructive file or shell operations unless the user explicitly asks for them.\n' +
  '6. If the task can be answered without tools or skills, answer directly and keep the response concise.\n' +
  'When the user explicitly names a project skill, load that skill before doing the task.';

function normalizeUuid(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(trimmed)
    ? trimmed
    : null;
}

async function resolveClaudeSessionBinding(
  sessionStore: any,
  conversationId: string,
  cwd: string,
): Promise<{ sessionId?: string; resume?: string }> {
  const sessionId = normalizeUuid(conversationId);
  if (!sessionId) {
    logger.log(`[session] skip SDK session binding: invalid conversationId=${conversationId}`);
    return {};
  }

  try {
    // `dir` is load-bearing even when going through sessionStore: getSessionInfo
    // derives the project key from `dir`, and the EdgeOne SessionStore namespaces
    // its blob keys by `projectKey`. Drop `dir` and load() never finds a match.
    const info = await getSessionInfo(sessionId, { dir: cwd, sessionStore });
    if (info) {
      logger.log(`[session] resume Claude SDK sessionId=${sessionId}`);
      return { resume: sessionId };
    }
    logger.log(`[session] create Claude SDK sessionId=${sessionId}`);
  } catch (e) {
    logger.error('[session] failed to inspect sessionStore for resume:', e);
  }

  return { sessionId };
}

function buildAgentOptions(opts?: {
  claudeSessionStore?: any;
  mcpServer?: any;
  mcpServerName?: string;
  allowedTools?: string[];
  env?: Record<string, string | undefined>;
  sessionId?: string;
  resume?: string;
}) {
  const ctxEnv = opts?.env ?? {};
  const cwd = process.cwd();
  const allowedTools = opts?.allowedTools ?? [];
  const options: Record<string, any> = {
    model: resolveModelName(ctxEnv),
    systemPrompt: SYSTEM_PROMPT,
    cwd,
    // Keep Claude Code's built-in tools disabled except for the SDK skill
    // loader. EdgeOne sandbox tools are exposed separately through MCP below.
    tools: ['Skill'],
    allowedTools,
    settingSources: ["project"],
    skills: "all",
    permissionMode: 'bypassPermissions',
    maxTurns: 10,
    env: {
      ...ctxEnv,
      ...collectGatewayEnv(ctxEnv),
    },
    // DEBUG: forward CLI subprocess stderr (auth errors, model errors, etc.)
    // to our logger so "Claude Code process exited with code 1" stops being a
    // black box. Each line goes through logger.error so it ends up in the
    // dev-server console. Remove or gate behind an env flag once you're done
    // debugging.
    stderr: (line: string) => {
      logger.error('[claude-cli stderr]', line);
    },
  };
  if (opts?.claudeSessionStore) {
    options.sessionStore = opts.claudeSessionStore;
  }
  if (opts?.resume) {
    options.resume = opts.resume;
  } else if (opts?.sessionId) {
    options.sessionId = opts.sessionId;
  }
  if (opts?.mcpServer && opts?.mcpServerName) {
    options.mcpServers = { [opts.mcpServerName]: opts.mcpServer };
  }
  return options;
}

export async function onRequest(context: any) {
  const body = context.request.body ?? {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const userMsgId = typeof body.userMsgId === 'string' ? body.userMsgId : undefined;
  const botMsgId = typeof body.botMsgId === 'string' ? body.botMsgId : undefined;
  const rawUserId = typeof body.userId === 'string' ? body.userId : (typeof body.user_id === 'string' ? body.user_id : '');
  const userId = rawUserId.trim() || undefined;

  if (!message) {
    return new Response(
      JSON.stringify({ error: "'message' is required" }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const signal: AbortSignal | undefined = context.request.signal;
  const conversationId: string = context.conversation_id ?? '';
  const { store } = context;

  logger.log(`[request] cid=${conversationId}, uid=${userId ?? '-'}, message="${message.slice(0, 50)}..."`);

  // EdgeOne store returns a Claude SDK-compatible SessionStore for transcript persistence.
  const claudeSessionStore = store.claudeSessionStore();

  // Save user message to store (with frontend-generated ID for history alignment)
  if (conversationId) {
    try {
      const appendArgs: Record<string, unknown> = {
        conversationId,
        role: 'user',
        content: message,
        messageId: userMsgId,
      };
      if (userId) appendArgs.userId = userId;
      await store.appendMessage(appendArgs);
    } catch (e) { logger.error('[store] failed to save user message:', e); }
  }

  const { tools } = context;
  if (typeof tools.toClaudeMcpServer !== 'function') {
    throw new Error('Upgrade EdgeOne Makers agent runtime: `context.tools.toClaudeMcpServer` is required.');
  }
  const edgeoneMcp = tools.toClaudeMcpServer();

  const mcpServer = createSdkMcpServer({
    name: edgeoneMcp.name,
    tools: edgeoneMcp.tools,
    alwaysLoad: true,
  });

  const { allowedTools } = edgeoneMcp;
  logger.log('[tools] registered EdgeOne MCP tools:', allowedTools);

  const sessionBinding = await resolveClaudeSessionBinding(claudeSessionStore, conversationId, process.cwd());
  const options = buildAgentOptions({
    claudeSessionStore,
    mcpServer,
    mcpServerName: edgeoneMcp.name,
    allowedTools,
    env: context.env,
    ...sessionBinding,
  });
  const stream = createChatStream({
    message,
    options,
    signal,
    logger,
    conversationId,
    store,
    botMsgId,
    userId,
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
