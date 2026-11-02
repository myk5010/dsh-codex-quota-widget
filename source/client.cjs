const React = require('react');
const h = React.createElement;
const POLL_MS = 5000;
const RPC_TIMEOUT_MS = 15000;
const DEBUG_LIMIT = 300;
const DEBUG_TTL_MS = 1800000;
// Never copy arbitrary RPC objects into diagnostics, even when the Host is trusted.
const HOST_EVENTS = new Set(['debug_enabled','debug_disabled','debug_expired','query_started','stage','upstream_headers','query_succeeded','query_failed','backoff','cache_hit','join_inflight','query_cancelled','deadline_exceeded','credentials_changed','rpc_completed','refresh_headers','refresh_succeeded','refresh_failed']);
const HOST_STAGES = new Set(['credentials_read','credentials_lock','oauth_refresh','upstream_fetch','body_read','normalize','rpc']);
const SAFE_NAMES = new Set(['Error','QuotaError','TypeError','SyntaxError','AbortError','TimeoutError','ConnectTimeoutError','HeadersTimeoutError','BodyTimeoutError','SocketError']);
const NETWORK_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UND_ERR_ABORTED','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE','ECANCELED']);
const safeNumber = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(n)) : null;
function safeHostEntry(input) {
  if (!input || input.source !== 'host' || !HOST_EVENTS.has(input.event)) return null;
  const out = { source: 'host', event: input.event };
  for (const key of ['seq','timestampMs','durationMs','elapsedMs','timeoutMs','pollIntervalMs','cacheAgeMs','retryMs','failures']) {
    const n = safeNumber(input[key]); if (n !== null) out[key] = n;
  }
  if (typeof input.requestId === 'string' && /^q\d{1,16}$/.test(input.requestId)) out.requestId = input.requestId;
  if (HOST_STAGES.has(input.stage)) out.stage = input.stage;
  if (Object.hasOwn(ERRORS, input.errorCode)) out.errorCode = input.errorCode;
  for (const key of ['errorName','causeName']) if (SAFE_NAMES.has(input[key])) out[key] = input[key];
  if (NETWORK_CODES.has(input.networkCode)) out.networkCode = input.networkCode;
  if (Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599) out.httpStatus = input.httpStatus;
  if (['json','html','text','other'].includes(input.contentType)) out.contentType = input.contentType;
  for (const key of ['timedOut','aborted','refreshNeeded']) if (typeof input[key] === 'boolean') out[key] = input[key];
  return out;
}
function safeClientEntry(input) {
  if (!input || input.source !== 'client' || input.event !== 'status_rpc' || typeof input.requestId !== 'string' || !/^r\d{1,16}$/.test(input.requestId)) return null;
  const out = { source: 'client', event: 'status_rpc', requestId: input.requestId, timeoutMs: RPC_TIMEOUT_MS };
  for (const key of ['timestampMs','durationMs']) { const n = safeNumber(input[key]); if (n !== null) out[key] = n; }
  for (const key of ['ok','aborted']) if (typeof input[key] === 'boolean') out[key] = input[key];
  return out;
}
function safeDebugInfo(input, now = Date.now()) {
  const value = input && typeof input === 'object' ? input : {};
  const out = { enabled: false, startedAt: safeNumber(value.startedAt), expiresAt: safeNumber(value.expiresAt), generation: safeNumber(value.generation) ?? 0,
    count: Math.min(DEBUG_LIMIT, safeNumber(value.count) ?? 0), lastSeq: safeNumber(value.lastSeq) ?? 0,
    maxEntries: DEBUG_LIMIT, ttlMs: DEBUG_TTL_MS, timeoutMs: safeNumber(value.timeoutMs) ?? 10000, pollIntervalMs: POLL_MS };
  out.enabled = value.enabled === true && out.expiresAt !== null && now < out.expiresAt;
  out.entries = Array.isArray(value.entries) ? value.entries.slice(-DEBUG_LIMIT).map(safeHostEntry).filter(Boolean) : [];
  return out;
}
function createClientJournal({ now = Date.now } = {}) {
  let info = safeDebugInfo(null, now()), entries = [], seq = 0, epoch = 0;
  const active = () => info.enabled && now() < info.expiresAt;
  return {
    sync(value) {
      const next = safeDebugInfo(value, now());
      if (next.generation !== info.generation) { entries = []; seq = 0; }
      info = next; return this.info();
    },
    info() { return safeDebugInfo(info, now()); },
    begin() { return active() ? { generation: info.generation, epoch, requestId: `r${++seq}` } : null; },
    record(token, fields) {
      if (!token || !active() || token.generation !== info.generation || token.epoch !== epoch) return;
      const entry = safeClientEntry({ ...fields, source: 'client', event: 'status_rpc', requestId: token.requestId });
      if (entry) { entries.push(entry); if (entries.length > DEBUG_LIMIT) entries.splice(0, entries.length - DEBUG_LIMIT); }
    },
    clear() { entries = []; epoch++; },
    snapshot() { return entries.map(safeClientEntry).filter(Boolean); },
  };
}
function createClientRPC({ rpc, now = Date.now, clientJournal = createClientJournal({ now }), timers = globalThis }) {
  let controlVersion = 0;
  return {
    clientJournal,
    async call(signal) {
      const start = now(), token = clientJournal.begin(), version = controlVersion; let ok = false;
      try {
        const response = await rpc.call('/api', 'codex-quota/status', {}, signal);
        ok = response?.ok === true;
        if (ok && version === controlVersion && response.value?.debug) clientJournal.sync(response.value.debug);
        return response;
      } finally {
        clientJournal.record(token, { timestampMs: now(), durationMs: Math.max(0, now() - start), ok, aborted: signal?.aborted === true });
      }
    },
    async callDebug(action, signal) {
      if (!['enable','disable','clear','read'].includes(action)) throw new Error('debug_operation_failed');
      const controller = signal ? null : new AbortController();
      const timeout = controller ? timers.setTimeout(() => controller.abort(), RPC_TIMEOUT_MS) : null;
      try {
        const response = await rpc.call('/api', 'codex-quota/debug', { action }, signal || controller.signal);
        if (response?.ok === true && response.value) {
          controlVersion++;
          clientJournal.sync(response.value);
          if (action === 'clear') clientJournal.clear();
        }
        return response;
      } finally { if (timeout !== null) timers.clearTimeout(timeout); }
    },
  };
}
function buildDebugExport(debug, clientEntries, now = Date.now()) {
  const host = safeDebugInfo(debug, now);
  return { schemaVersion: 1, capturedAt: new Date(now).toISOString(),
    config: { maxEntries: DEBUG_LIMIT, ttlMs: DEBUG_TTL_MS, timeoutMs: host.timeoutMs, pollIntervalMs: POLL_MS, clientRpcTimeoutMs: RPC_TIMEOUT_MS },
    host, client: { entries: Array.isArray(clientEntries) ? clientEntries.slice(-DEBUG_LIMIT).map(safeClientEntry).filter(Boolean) : [] } };
}
function downloadDebugExport(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'codex-quota-debug.json';
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function clientDebugLine(entry) {
  return [clock(entry.timestampMs), entry.requestId, entry.ok ? 'RPC成功' : 'RPC失败', `${entry.durationMs ?? 0}ms`, entry.aborted ? 'aborted' : null].filter(Boolean).join(' · ');
}
function debugLine(entry) {
  return [clock(entry.timestampMs), entry.event, entry.stage, entry.durationMs !== undefined ? `${entry.durationMs}ms` : entry.elapsedMs !== undefined ? `${entry.elapsedMs}ms` : null,
    entry.httpStatus ? `HTTP ${entry.httpStatus}` : null, entry.errorCode, entry.errorName, entry.causeName, entry.networkCode,
    entry.timedOut ? 'timeout' : null, entry.aborted ? 'aborted' : null, entry.retryMs !== undefined ? `retry ${entry.retryMs}ms` : null].filter(Boolean).join(' · ');
}
const ERRORS = {
  not_logged_in: '未登录 Codex', login_expired: '需要重新登录', access_denied: '额度接口拒绝访问',
  rate_limited: '接口限流，稍后重试', network_error: '网络错误，稍后重试',
  upstream_error: '上游暂时不可用', schema_changed: '额度格式未知', connection_error: 'DSH 连接中断',
};

function windowLabel(w) {
  const s = w.windowSeconds;
  const group = w.group === 'review' ? '代码审查 · ' : /^extra-/.test(w.group || '') ? '额外 · ' : '';
  if (s === 604800) return group + '7 天';
  if (s === 18000) return group + '5 小时';
  if (s && s % 86400 === 0) return group + (s / 86400) + ' 天';
  if (s && s % 3600 === 0) return group + (s / 3600) + ' 小时';
  return group + '额度窗口';
}
function percent(n) { return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 10) / 10}%` : '未知'; }
function clock(ms) { return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '未提供'; }
function resetCountdown(resetAt, now = Date.now()) {
  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt) || resetAt <= 0 || !Number.isFinite(now))
    return '重置时间未知';
  const remainingMs = resetAt - now;
  if (remainingMs <= 0) return '待刷新';
  const minutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return '不足1分钟';
}
function brief(data, now = Date.now()) {
  if (data.windows?.length) {
    const w = data.windows.filter(x => x.group === 'codex');
    const text = (w.length ? w : data.windows).slice(0, 2)
      .map(x => `${resetCountdown(x.resetAt, now)} ${percent(x.remainingPercent)}`).join(' · ');
    return text;
  }
  return data.status === 'loading' ? '查询中…' : '';
}

function createPoller({ call, onChange, timers = globalThis, documentRef = null }) {
  let active = false, pending = false, interval = null, controller = null, timeout = null;
  let last = { status: 'loading', windows: [], updatedAt: null };
  async function tick() {
    if (!active || pending || documentRef?.hidden) return;
    pending = true; controller = new AbortController(); const request = controller;
    timeout = timers.setTimeout(() => request.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await call(request.signal);
      if (!active) return;
      if (!response?.ok || !response.value || !Array.isArray(response.value.windows)) throw new Error('connection_error');
      last = response.value; onChange(last);
    } catch {
      if (active) { last = { ...last, status: 'error', errorCode: 'connection_error', stale: last.windows.length > 0 }; onChange(last); }
    } finally { timers.clearTimeout(timeout); timeout = null; controller = null; pending = false; }
  }
  const visible = () => { if (!documentRef?.hidden) void tick(); };
  return {
    start() {
      if (active) return; active = true; void tick();
      interval = timers.setInterval(() => void tick(), POLL_MS);
      documentRef?.addEventListener('visibilitychange', visible);
    },
    stop() {
      active = false; timers.clearInterval(interval); timers.clearTimeout(timeout); controller?.abort();
      documentRef?.removeEventListener('visibilitychange', visible);
    },
    tick,
  };
}

const CSS = `
.dsh-codex-quota { position:fixed; right:16px; bottom:96px; z-index:90; pointer-events:auto; font:12px/1.5 system-ui,sans-serif; color:var(--dsw-alias-label-primary,#242428); }
.dsh-codex-quota[data-expanded="true"]::before { content:""; position:absolute; right:0; bottom:100%; height:12px; width:min(320px,calc(100vw - 32px)); pointer-events:auto; }
.dsh-codex-quota button { font:inherit; cursor:pointer; color:inherit; }
.dsh-codex-quota-toggle { display:flex; align-items:center; gap:6px; max-width:min(390px,calc(100vw - 32px)); padding:5px 10px; border:1px solid var(--dsw-alias-border-primary,#d4d4d8); border-radius:16px; background:var(--dsw-alias-background-primary,#fff); box-shadow:0 2px 10px #0002; text-align:left; }
.dsh-codex-quota-dot { width:7px; height:7px; flex-shrink:0; background:#16a34a; border-radius:50%; }
.dsh-codex-quota-dot[data-state=error] { background:#dc2626; }
.dsh-codex-quota-dot[data-state=empty] { background:#dc2626; }
.dsh-codex-quota-panel { position:absolute; right:0; bottom:38px; width:min(320px,calc(100vw - 32px)); box-sizing:border-box; padding:14px; border:1px solid var(--dsw-alias-border-primary,#d4d4d8); border-radius:12px; background:var(--dsw-alias-background-primary,#fff); box-shadow:0 4px 24px #0003; max-height:65vh; overflow:auto; }
.dsh-codex-quota-head { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; }
.dsh-codex-quota-title { font-size:14px; font-weight:600; }
.dsh-codex-quota-row { margin:12px 0; }
.dsh-codex-quota-row-top { display:flex; justify-content:space-between; gap:8px; }
.dsh-codex-quota progress { display:block; width:100%; height:6px; accent-color:#16a34a; margin:6px 0; }
.dsh-codex-quota-muted { color:var(--dsw-alias-label-secondary,#71717a); font-size:11px; }
.dsh-codex-quota-warning { color:#b45309; margin:8px 0; }
.dsh-codex-quota-close { border:0; background:transparent; font-size:16px!important; }
.dsh-codex-quota-debug { border-top:1px solid var(--dsw-alias-border-primary,#d4d4d8); margin-top:10px; padding-top:8px; }
.dsh-codex-quota-debug label { display:flex; align-items:center; gap:6px; }
.dsh-codex-quota-debug-actions { display:flex; gap:8px; margin:6px 0; }
.dsh-codex-quota-debug-log { max-height:150px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:10px/1.5 monospace; margin:6px 0; }
.dsh-codex-quota-debug-actions button { border:1px solid var(--dsw-alias-border-primary,#d4d4d8); border-radius:4px; background:transparent; }
body[data-ds-dark-theme] .dsh-codex-quota-toggle, body[data-ds-dark-theme] .dsh-codex-quota-panel { background:#222228; color:#f4f4f5; border-color:#52525b; }
body:has([aria-modal="true"], dialog[open]) .dsh-codex-quota { visibility:hidden; pointer-events:none; }
@media(max-width:600px) { .dsh-codex-quota { right:8px; bottom:88px; } .dsh-codex-quota-toggle { font-size:11px; } }
`;
function Badge({ call, callDebug, clientJournal }) {
  const [data, setData] = React.useState({ status: 'loading', windows: [], updatedAt: null });
  const [expanded, setExpanded] = React.useState(false);
  const [debug, setDebug] = React.useState(() => safeDebugInfo(null));
  const [debugBusy, setDebugBusy] = React.useState(false);
  const [debugError, setDebugError] = React.useState(false);
  React.useEffect(() => {
    const poller = createPoller({ call, onChange: value => {
      setData(value);
      setDebug(clientJournal ? clientJournal.info() : safeDebugInfo(value.debug));
    }, documentRef: typeof document === 'undefined' ? null : document });
    poller.start(); return () => poller.stop();
  }, [call, clientJournal]);
  React.useEffect(() => {
    if (!debug.enabled) return;
    // One local expiry wakeup, not another polling interval or log request.
    const timer = setTimeout(() => setDebug(value => safeDebugInfo(value)), Math.max(0, debug.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [debug.enabled, debug.expiresAt]);
  async function debugAction(action) {
    if (!callDebug || debugBusy) return;
    setDebugBusy(true); setDebugError(false);
    try {
      const response = await callDebug(action);
      if (!response?.ok || !response.value) throw new Error('debug_operation_failed');
      const info = safeDebugInfo(response.value);
      setDebug(info);
      if (action === 'clear') clientJournal?.clear();
      if (action === 'read') downloadDebugExport(buildDebugExport(info, clientJournal?.snapshot()));
    } catch {
      setDebugError(true);
      if (action === 'read') {
        // The local RPC log is most useful precisely when Host cannot be reached.
        downloadDebugExport({ ...buildDebugExport(debug, clientJournal?.snapshot()), hostReadFailed: true });
      }
    } finally { setDebugBusy(false); }
  }
  React.useEffect(() => {
    if (!expanded) return;
    const close = e => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, [expanded]);
  const clientRows = clientJournal?.snapshot() || [];
  const state = data.status !== 'ok' || data.stale || data.windows.length === 0 ? 'error' : data.limitReached || data.windows.some(w => w.remainingPercent === 0) ? 'empty' : 'ok';
  return h('div', { className: 'dsh-codex-quota', 'data-testid': 'codex-quota-badge', 'data-expanded': expanded,
    onPointerEnter: e => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') setExpanded(true); },
    onPointerLeave: e => { if (e.pointerType !== 'touch') setExpanded(false); },
    onFocus: e => { if (e.target.matches(':focus-visible')) setExpanded(true); },
    onBlur: e => { if (!e.relatedTarget?.nodeType || !e.currentTarget.contains(e.relatedTarget)) setExpanded(false); },
  },
    expanded && h('section', { className: 'dsh-codex-quota-panel', id: 'dsh-codex-quota-details', 'aria-label': 'Codex 剩余额度' },
      h('div', { className: 'dsh-codex-quota-head' }, h('span', { className: 'dsh-codex-quota-title' }, 'ChatGPT Codex 额度'),
        h('button', { className: 'dsh-codex-quota-close', 'aria-label': '收起额度详情', onClick: () => setExpanded(false) }, '×')),
      data.errorCode && h('div', { className: 'dsh-codex-quota-warning' }, ERRORS[data.errorCode] || '查询失败'),
      data.limitReached === true && h('div', { className: 'dsh-codex-quota-warning' }, '上游报告额度已耗尽。'),
      data.windows.map(w => h('div', { className: 'dsh-codex-quota-row', key: w.id },
        h('div', { className: 'dsh-codex-quota-row-top' }, h('span', null, windowLabel(w)), h('strong', null, `剩余 ${percent(w.remainingPercent)}`)),
        h('progress', { value: w.remainingPercent, max: 100, 'aria-label': `${windowLabel(w)}剩余额度` }),
        h('div', { className: 'dsh-codex-quota-muted' }, `重置：${clock(w.resetAt)}`))),
      data.credits?.unlimited === true && h('div', null, '附加额度：不限额（不代表订阅窗口不限额）'),
      h('div', { className: 'dsh-codex-quota-muted' }, `上次成功更新：${clock(data.updatedAt)}`),
      h('div', { className: 'dsh-codex-quota-muted' }, '每 5 秒查询 · 限流时退避 · 仅显示上游公布的比例'),
      data.status === 'error' && data.nextFetchAt && h('div', { className: 'dsh-codex-quota-muted' }, `下次尝试：${clock(data.nextFetchAt)}`),
      h('div', { className: 'dsh-codex-quota-debug' },
        h('label', null, h('input', { type: 'checkbox', checked: safeDebugInfo(debug).enabled, disabled: debugBusy || !callDebug,
          onChange: event => void debugAction(event.target.checked ? 'enable' : 'disable') }), 'Debug 日志'),
        h('div', { className: 'dsh-codex-quota-muted' }, '默认关闭 / 内存最近300条 / 30分钟自动停止'),
        h('div', { className: 'dsh-codex-quota-debug-actions' },
          h('button', { type: 'button', disabled: debugBusy || !callDebug, onClick: () => void debugAction('clear') }, '清空日志'),
          h('button', { type: 'button', disabled: debugBusy || !callDebug, onClick: () => void debugAction('read') }, '导出 JSON')),
        debugError && h('div', { role: 'status', className: 'dsh-codex-quota-warning' }, '调试操作失败'),
        h('div', { className: 'dsh-codex-quota-muted' }, `Host 日志 ${debug.count}/300 · 最近 ${debug.entries.length} 条`),
        h('pre', { className: 'dsh-codex-quota-debug-log', 'aria-label': 'Host 调试日志' }, debug.entries.length ? debug.entries.map(debugLine).join('\n') : '暂无日志'),
        h('div', { className: 'dsh-codex-quota-muted' }, `浏览器 RPC 日志 ${clientRows.length}/300 · 最近10条`),
        h('pre', { className: 'dsh-codex-quota-debug-log', 'aria-label': '浏览器 RPC 调试日志' }, clientRows.length ? clientRows.slice(-10).map(clientDebugLine).join('\n') : '暂无日志'))),
    h('button', { type: 'button', className: 'dsh-codex-quota-toggle', onClick: e => {
        // Desktop hover stays open on click; keep keyboard and touch toggling.
        if (e.detail === 0 || e.nativeEvent?.pointerType === 'touch' || !window.matchMedia('(hover: hover)').matches)
          setExpanded(value => !value);
      },
      'aria-expanded': expanded, 'aria-controls': 'dsh-codex-quota-details', 'aria-label': state === 'error' ? 'Codex 额度查询异常，查看详情' : '查看 Codex 剩余额度与重置时间' },
      h('span', { className: 'dsh-codex-quota-dot', 'data-state': state, 'aria-hidden': true }),
      h('span', null, brief(data))));
}
exports.inject = ['slots', 'connection'];
exports.apply = ctx => {
  const { call, callDebug, clientJournal } = createClientRPC({ rpc: ctx.connection.rpc });
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = 'dsh-codex-quota-widget';
    style.textContent = CSS; document.head.appendChild(style); return () => style.remove();
  });
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'codex-quota-badge', inject: () => ({ call, callDebug, clientJournal }),
  }, Badge));
};
// Export pure parts for the bundle/clock/UI regression tests, not host credentials.
exports.testing = { createPoller, windowLabel, percent, resetCountdown, brief, Badge, CSS, safeHostEntry, safeClientEntry, safeDebugInfo, createClientJournal, createClientRPC, buildDebugExport, debugLine, clientDebugLine };
