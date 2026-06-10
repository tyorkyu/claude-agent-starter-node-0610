import { useCallback, useMemo, useRef, useState } from 'react';
import { runSingleTask, type TaskRecord, type TaskStatus } from './runner';

const DEFAULT_PROMPT =
  "Use the code_interpreter tool to run this Python snippet exactly once and reply with the printed line:\n" +
  "```python\nimport time, os, datetime\n" +
  "start = datetime.datetime.utcnow().isoformat()\n" +
  "time.sleep(8)\n" +
  "print(f'sandbox-ok pid={os.getpid()} start={start}')\n```";

const DOC_NOTE =
  '已知约束：每个 conversation_id 对应一个 sandbox；sandbox 并发上限 20；会话空闲回收 5 分钟；sandbox 超时 5 分钟。';

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function statusColor(s: TaskStatus): string {
  switch (s) {
    case 'pending': return '#888';
    case 'connecting': return '#1f7ae0';
    case 'running': return '#0a8a4a';
    case 'success': return '#1aa260';
    case 'rate_limited': return '#d4881a';
    case 'error': return '#c0392b';
    case 'aborted': return '#666';
  }
}

function fmtMs(ms?: number): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function SandboxBench() {
  const [concurrency, setConcurrency] = useState(25);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tasksRef = useRef<TaskRecord[]>([]);

  const onTaskUpdate = useCallback((task: TaskRecord) => {
    // Replace by reference; trigger React re-render via shallow array copy
    const next = tasksRef.current.slice();
    next[task.index] = { ...task };
    tasksRef.current = next;
    setTasks(next);
  }, []);

  const start = useCallback(async () => {
    if (running) return;
    const n = Math.max(1, Math.min(200, Math.floor(concurrency)));
    const initial: TaskRecord[] = Array.from({ length: n }, (_, i) => ({
      index: i,
      conversationId: uuid(),
      status: 'pending' as TaskStatus,
      startedAt: 0,
      toolCalls: [],
      textPreview: '',
      rawEvents: [],
    }));
    tasksRef.current = initial;
    setTasks(initial);
    setSelectedIdx(null);

    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);

    const now = Date.now();
    const promises = initial.map((t) => {
      t.startedAt = now;
      return runSingleTask(t, prompt, { onTaskUpdate }, ac.signal);
    });
    try {
      await Promise.allSettled(promises);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [concurrency, prompt, running, onTaskUpdate]);

  const stopAll = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const stats = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      pending: 0,
      connecting: 0,
      running: 0,
      success: 0,
      rate_limited: 0,
      error: 0,
      aborted: 0,
    };
    let liveConcurrency = 0;
    let durSum = 0;
    let durCount = 0;
    for (const t of tasks) {
      counts[t.status]++;
      if (t.status === 'connecting' || t.status === 'running') liveConcurrency++;
      if (t.endedAt && t.startedAt) {
        durSum += t.endedAt - t.startedAt;
        durCount++;
      }
    }
    const avg = durCount ? Math.round(durSum / durCount) : 0;
    return { counts, liveConcurrency, avg, total: tasks.length };
  }, [tasks]);

  const selected = selectedIdx != null ? tasks[selectedIdx] : null;

  return (
    <div className="bench-root">
      <header className="bench-header">
        <h1>EdgeOne Sandbox 并发测试</h1>
        <p className="bench-note">{DOC_NOTE}</p>
      </header>

      <section className="bench-controls">
        <label>
          并发数
          <input
            type="number"
            min={1}
            max={200}
            value={concurrency}
            disabled={running}
            onChange={(e) => setConcurrency(parseInt(e.target.value, 10) || 1)}
          />
        </label>
        <div className="bench-actions">
          <button className="primary" onClick={start} disabled={running}>
            {running ? '运行中…' : '开始测试'}
          </button>
          <button onClick={stopAll} disabled={!running}>
            中止全部
          </button>
        </div>
        <details className="bench-prompt">
          <summary>Prompt（让 Agent 调用 sandbox 的 code_interpreter）</summary>
          <textarea
            value={prompt}
            disabled={running}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
          />
        </details>
      </section>

      <section className="bench-stats">
        <Stat label="实时并发" value={`${stats.liveConcurrency}`} accent="#1f7ae0" />
        <Stat label="总任务" value={`${stats.total}`} />
        <Stat label="成功" value={`${stats.counts.success}`} accent="#1aa260" />
        <Stat label="限流/超并发" value={`${stats.counts.rate_limited}`} accent="#d4881a" />
        <Stat label="错误" value={`${stats.counts.error}`} accent="#c0392b" />
        <Stat label="排队中" value={`${stats.counts.pending + stats.counts.connecting}`} />
        <Stat label="运行中" value={`${stats.counts.running}`} accent="#0a8a4a" />
        <Stat label="中止" value={`${stats.counts.aborted}`} />
        <Stat label="平均耗时" value={fmtMs(stats.avg)} />
      </section>

      <section className="bench-table-wrap">
        <table className="bench-table">
          <thead>
            <tr>
              <th>#</th>
              <th>conversation_id</th>
              <th>状态</th>
              <th>HTTP</th>
              <th>TTFB</th>
              <th>耗时</th>
              <th>tool</th>
              <th>错误 / 摘要</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const ttfb = t.firstByteAt && t.startedAt ? t.firstByteAt - t.startedAt : undefined;
              const dur = t.endedAt && t.startedAt ? t.endedAt - t.startedAt : undefined;
              const summary = t.errorMessage || t.textPreview || '';
              return (
                <tr key={t.conversationId} className={selectedIdx === t.index ? 'selected' : ''}>
                  <td>{t.index}</td>
                  <td className="mono small">{t.conversationId.slice(0, 8)}…</td>
                  <td>
                    <span className="status-dot" style={{ background: statusColor(t.status) }} />
                    {t.status}
                  </td>
                  <td>{t.httpStatus ?? '-'}</td>
                  <td>{fmtMs(ttfb)}</td>
                  <td>{fmtMs(dur)}</td>
                  <td className="mono small">{t.toolCalls.join(',')}</td>
                  <td className="summary-cell">{summary.slice(0, 120)}</td>
                  <td>
                    <button onClick={() => setSelectedIdx(t.index)}>详情</button>
                  </td>
                </tr>
              );
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: '#888', padding: 24 }}>
                  尚未开始测试
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {selected && (
        <section className="bench-detail">
          <div className="detail-header">
            <h3>任务 #{selected.index} · {selected.conversationId}</h3>
            <button onClick={() => setSelectedIdx(null)}>关闭</button>
          </div>
          <div className="detail-meta">
            <span>状态：{selected.status}</span>
            <span>HTTP：{selected.httpStatus ?? '-'}</span>
            <span>tool：{selected.toolCalls.join(', ') || '-'}</span>
          </div>
          {selected.errorRaw && (
            <pre className="detail-error">{selected.errorRaw}</pre>
          )}
          {selected.textPreview && (
            <div className="detail-section">
              <h4>Assistant 文本</h4>
              <pre>{selected.textPreview}</pre>
            </div>
          )}
          <div className="detail-section">
            <h4>SSE 原始事件（{selected.rawEvents.length}）</h4>
            <pre className="raw-events">
              {selected.rawEvents
                .map((e) => `[${new Date(e.ts).toISOString().slice(11, 23)}] ${e.event}: ${e.data}`)
                .join('\n')}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: accent }}>{value}</div>
    </div>
  );
}
