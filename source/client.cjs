const React = require('react');
const h = React.createElement;
const POLL_MS = 5000;
const ERRORS = {
  not_logged_in: '未登录 Codex', login_expired: '登录已过期', access_denied: '额度接口拒绝访问',
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
    return `${text}${data.stale || data.status !== 'ok' ? '（过期）' : ''}`;
  }
  return `Codex · ${ERRORS[data.errorCode] || (data.status === 'loading' ? '查询中…' : '额度未知')}`;
}

function createPoller({ call, onChange, timers = globalThis, documentRef = null }) {
  let active = false, pending = false, interval = null, controller = null, timeout = null;
  let last = { status: 'loading', windows: [], updatedAt: null };
  async function tick() {
    if (!active || pending || documentRef?.hidden) return;
    pending = true; controller = new AbortController(); const request = controller;
    timeout = timers.setTimeout(() => request.abort(), 15000);
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
.dsh-codex-quota-dot[data-state=error] { background:#d97706; }
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
body[data-ds-dark-theme] .dsh-codex-quota-toggle, body[data-ds-dark-theme] .dsh-codex-quota-panel { background:#222228; color:#f4f4f5; border-color:#52525b; }
body:has([aria-modal="true"], dialog[open]) .dsh-codex-quota { visibility:hidden; pointer-events:none; }
@media(max-width:600px) { .dsh-codex-quota { right:8px; bottom:88px; } .dsh-codex-quota-toggle { font-size:11px; } }
`;
function Badge({ call }) {
  const [data, setData] = React.useState({ status: 'loading', windows: [], updatedAt: null });
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    const poller = createPoller({ call, onChange: setData, documentRef: typeof document === 'undefined' ? null : document });
    poller.start(); return () => poller.stop();
  }, [call]);
  React.useEffect(() => {
    if (!expanded) return;
    const close = e => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, [expanded]);
  const state = data.status !== 'ok' || data.stale ? 'error' : data.limitReached || data.windows.some(w => w.remainingPercent === 0) ? 'empty' : 'ok';
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
      data.stale && h('div', { className: 'dsh-codex-quota-warning' }, '以下为上次成功数据，当前已过期。'),
      data.limitReached === true && h('div', { className: 'dsh-codex-quota-warning' }, '上游报告额度已耗尽。'),
      data.windows.map(w => h('div', { className: 'dsh-codex-quota-row', key: w.id },
        h('div', { className: 'dsh-codex-quota-row-top' }, h('span', null, windowLabel(w)), h('strong', null, `剩余 ${percent(w.remainingPercent)}`)),
        h('progress', { value: w.remainingPercent, max: 100, 'aria-label': `${windowLabel(w)}剩余额度` }),
        h('div', { className: 'dsh-codex-quota-muted' }, `重置：${clock(w.resetAt)}`))),
      data.credits?.unlimited === true && h('div', null, '附加额度：不限额（不代表订阅窗口不限额）'),
      h('div', { className: 'dsh-codex-quota-muted' }, `上次成功更新：${clock(data.updatedAt)}`),
      h('div', { className: 'dsh-codex-quota-muted' }, '每 5 秒查询 · 限流时退避 · 仅显示上游公布的比例'),
      data.status === 'error' && data.nextFetchAt && h('div', { className: 'dsh-codex-quota-muted' }, `下次尝试：${clock(data.nextFetchAt)}`)),
    h('button', { type: 'button', className: 'dsh-codex-quota-toggle', onClick: e => {
        // Desktop hover stays open on click; keep keyboard and touch toggling.
        if (e.detail === 0 || e.nativeEvent?.pointerType === 'touch' || !window.matchMedia('(hover: hover)').matches)
          setExpanded(value => !value);
      },
      'aria-expanded': expanded, 'aria-controls': 'dsh-codex-quota-details', 'aria-label': '查看 Codex 剩余额度与重置时间' },
      h('span', { className: 'dsh-codex-quota-dot', 'data-state': state, 'aria-hidden': true }),
      h('span', null, brief(data))));
}
exports.inject = ['slots', 'connection'];
exports.apply = ctx => {
  const call = signal => ctx.connection.rpc.call('/api', 'codex-quota/status', {}, signal);
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = 'dsh-codex-quota-widget';
    style.textContent = CSS; document.head.appendChild(style); return () => style.remove();
  });
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'codex-quota-badge', inject: () => ({ call }),
  }, Badge));
};
// Export pure parts for the bundle/clock/UI regression tests, not host credentials.
exports.testing = { createPoller, windowLabel, percent, resetCountdown, brief, Badge, CSS };
