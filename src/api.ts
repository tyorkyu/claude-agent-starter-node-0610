/**
 * Backend API (EdgeOne Makers)
 *
 * Route mapping (file → route):
 *   agents/chat/index.ts    → POST /chat          Main chat endpoint
 *   agents/stop/index.ts    → POST /stop          Abort the active agent run
 *   cloud-functions/history/index.ts → POST /history        Get conversation history
 *   cloud-functions/clear-history/index.ts → POST /clear-history  Clear conversation history
 *   cloud-functions/conversations/index.ts → POST /conversations List conversations for a user
 *   cloud-functions/delete-conversation/index.ts → POST /delete-conversation  Permanently delete a conversation
 *
 * This file defines all API paths and request wrappers.
 */

import type { Message, ImageSsePayload, ListConversationsParams, ListConversationsResponse } from './types';

export const API = {
  chat: '/chat',
  chatStop: '/stop',
  history: '/history',
  clearHistory: '/clear-history',
  conversations: '/conversations',
  deleteConversation: '/delete-conversation',
} as const;

export interface RawSseEvent {
  eventType: string;
  data: unknown;
  raw: string;        // raw data string
  timestamp: number;
}

export interface SkillInfo {
  name: string;
  label?: string;
  description?: string;
}

export interface SkillLoadedPayload {
  name: string;
  status: 'loaded';
}

export interface StreamCallbacks {
  onTextDelta: (delta: string) => void;
  onToolCalled: (toolName: string) => void;
  onImage: (payload: ImageSsePayload) => void;
  onSkillAvailable?: (skills: SkillInfo[]) => void;
  onSkillLoaded?: (payload: SkillLoadedPayload) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  onRawEvent?: (event: RawSseEvent) => void;
}

/** Get conversation history for restoring the chat window after page refresh. */
export async function fetchConversationHistory(conversationId: string, userId?: string): Promise<Message[]> {
  const startTime = performance.now();
  console.log(`[history] start: ${new Date().toISOString()}`);

  try {
    const res = await fetch(API.history, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversation_id: conversationId, user_id: userId }),
    });

    if (!res.ok) {
      console.log(`[history] end: ${new Date().toISOString()}, total: ${(performance.now() - startTime).toFixed(2)}ms`);
      return [];
    }

    const data = await res.json().catch(() => null) as { messages?: Message[] } | null;
    const messages = Array.isArray(data?.messages) ? data.messages : [];

    console.log(`[history] end: ${new Date().toISOString()}, total: ${(performance.now() - startTime).toFixed(2)}ms`);
    return messages;
  } catch {
    console.log(`[history] end: ${new Date().toISOString()}, total: ${(performance.now() - startTime).toFixed(2)}ms`);
    return [];
  }
}

/**
 * Stream POST /chat via SSE
 * Backend pushes events: text_delta / tool_called / ping / done / error
 *
 * Returns an AbortController the caller can use to abort (or pair with /stop for graceful abort).
 */
export function sendMessageStream(
  message: string,
  callbacks: StreamCallbacks,
  conversationId?: string,
  messageIds?: { userMsgId: string; botMsgId: string },
  userId?: string,
): AbortController {
  const ctrl = new AbortController();

  (async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (conversationId) {
        headers['makers-conversation-id'] = conversationId;
      }

      const res = await fetch(API.chat, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          userMsgId: messageIds?.userMsgId,
          botMsgId: messageIds?.botMsgId,
          userId,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        callbacks.onError(new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError(new Error('ReadableStream not supported'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let doneReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE format: events separated by \n\n
        const parts = buffer.split('\n\n');
        // Last segment may be incomplete — keep in buffer
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          dispatchSseChunk(part, callbacks, () => { doneReceived = true; });
        }
      }

      // Fallback: trigger done only if backend did not send done event
      if (!doneReceived) {
        callbacks.onDone();
      }
    } catch (err) {
      // AbortError does not trigger error callback
      if (err instanceof DOMException && err.name === 'AbortError') return;
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return ctrl;
}

/** Parse a single SSE event and dispatch to the corresponding callback */
function dispatchSseChunk(part: string, cb: StreamCallbacks, markDone: () => void): void {
  let eventType = '';
  let data = '';

  for (const line of part.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  if (!eventType || !data) return;

  try {
    const parsed = JSON.parse(data);

    // Debug: push all raw events to onRawEvent
    if (cb.onRawEvent) {
      cb.onRawEvent({
        eventType,
        data: parsed,
        raw: data,
        timestamp: Date.now(),
      });
    }

    switch (eventType) {
      case 'text_delta':
        cb.onTextDelta(parsed.delta);
        break;
      case 'tool_called':
        cb.onToolCalled(parsed.tool);
        break;
      case 'image':
        if (parsed.base64) {
          cb.onImage({
            imageId: parsed.imageId || crypto.randomUUID(),
            base64: parsed.base64,
            mimeType: parsed.mimeType || 'image/png',
            size: parsed.size || 0,
          });
        }
        break;
      case 'error':
        cb.onError(new Error(parsed.message || 'agent returned error'));
        break;
      case 'skills_available':
        cb.onSkillAvailable?.(parsed.skills || []);
        break;
      case 'skill_loaded':
        cb.onSkillLoaded?.({ name: parsed.name, status: 'loaded' });
        break;
      case 'done':
        markDone();
        cb.onDone();
        break;
    }
  } catch {
    // Parse failure also pushed to debug
    if (cb.onRawEvent) {
      cb.onRawEvent({
        eventType,
        data: null,
        raw: data,
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Request the backend to abort the currently running agent
 *
 * Note: the stop request header must NOT carry the same conversation_id as chat,
 * otherwise the runtime will overwrite chat's cancel_event with stop's cancel_event,
 * causing abort_active_run to fail. The target conversation_id is passed only via body.
 */
export async function stopAgent(conversationId?: string): Promise<boolean> {
  try {
    /**
     * EdgeOne agents/ runtime requires Markers-Conversation-Id on every
     * agents/* request (since 2026-06-05 platform upgrade) — without it
     * the runtime returns 400 (`AGENT_CONVERSATION_ID_REQUIRED`) before
     * the handler runs.
     *
     * Earlier comments in this codebase warned that adding the header on
     * /stop would overwrite chat's abort signal slot. The new runtime is
     * expected to no longer have that bug; if you observe stop succeeding
     * but chat not actually aborting, revisit this and use a different
     * cancellation channel.
     */
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (conversationId) {
      headers['makers-conversation-id'] = conversationId;
    }
    const res = await fetch(API.chatStop, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversation_id: conversationId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Clear backend conversation history for the given conversation ID. */
export async function clearConversationHistory(conversationId?: string, userId?: string): Promise<boolean> {
  if (!conversationId) return false;

  try {
    const res = await fetch(API.clearHistory, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, user_id: userId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * List conversations for the given user (eo-uuid).
 * Returns at most `limit` (default 20) conversations ordered by lastMessageAt desc by default.
 * Pass `after` from a previous response's `nextCursor` to paginate.
 */
export async function listConversations(params: ListConversationsParams): Promise<ListConversationsResponse> {
  const startTime = performance.now();
  console.log(`[conversations] start: ${new Date().toISOString()}`);

  const empty: ListConversationsResponse = { conversations: [] };
  if (!params.userId) return empty;

  try {
    const res = await fetch(API.conversations, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        limit: params.limit ?? 20,
        order: params.order ?? 'desc',
        after: params.after,
        before: params.before,
      }),
    });

    if (!res.ok) {
      console.warn(`[conversations] HTTP ${res.status}`);
      console.log(`[conversations] end: ${new Date().toISOString()}, total: ${(performance.now() - startTime).toFixed(2)}ms`);
      return empty;
    }

    const data = await res.json().catch(() => null) as ListConversationsResponse | null;
    console.log(`[conversations] end: ${new Date().toISOString()}, total: ${(performance.now() - startTime).toFixed(2)}ms, count=${data?.conversations?.length ?? 0}`);
    if (!data || !Array.isArray(data.conversations)) return empty;
    return {
      conversations: data.conversations,
      nextCursor: data.nextCursor,
      previousCursor: data.previousCursor,
    };
  } catch (e) {
    console.warn('[conversations] request failed:', e);
    return empty;
  }
}

/**
 * Permanently delete a conversation (messages + metadata + index).
 * Irreversible — caller must already have confirmed with the user.
 */
export async function deleteConversation(conversationId: string, userId?: string): Promise<boolean> {
  if (!conversationId) return false;

  try {
    const res = await fetch(API.deleteConversation, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, user_id: userId }),
    });
    return res.ok;
  } catch (e) {
    console.warn('[delete-conversation] request failed:', e);
    return false;
  }
}
