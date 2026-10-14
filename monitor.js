// No DSH dependencies or credentials in the public snapshot.
export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const POLL_MS = 5000;
export class QuotaError extends Error {
  constructor(code, retryMs = 0) { super(code); this.code = code; this.retryMs = retryMs; }
}
const finite = n => typeof n === 'number' && Number.isFinite(n);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const plans = new Set(['free', 'plus', 'pro', 'prolite', 'team', 'business', 'enterprise', 'edu']);

function normalizeWindow(window, id, group, now) {
  if (!object(window) || !finite(window.used_percent)) return null;
  const windowSeconds = finite(window.limit_window_seconds) && window.limit_window_seconds > 0
    ? window.limit_window_seconds : null;
  let resetAt = finite(window.reset_at) && window.reset_at > 0
    ? (window.reset_at < 1e12 ? window.reset_at * 1000 : window.reset_at) : null;
  if (resetAt === null && finite(window.reset_after_seconds) && window.reset_after_seconds >= 0)
    resetAt = now + window.reset_after_seconds * 1000;
  const usedPercent = Math.max(0, Math.min(100, window.used_percent));
  return { id, group, windowSeconds, usedPercent, remainingPercent: 100 - usedPercent, resetAt };
}

export function normalizeQuota(raw, now = Date.now()) {
  if (!object(raw)) throw new QuotaError('schema_changed');
  const windows = [];
  function addGroup(group, name) {
    if (!object(group)) return;
    for (const field of ['primary_window', 'secondary_window']) {
      const window = normalizeWindow(group[field], `${name}:${field}`, name, now);
      if (window) windows.push(window);
    }
  }
  addGroup(raw.rate_limit, 'codex');
  addGroup(raw.code_review_rate_limit, 'review');
  if (Array.isArray(raw.additional_rate_limits)) {
    raw.additional_rate_limits.slice(0, 8).forEach((g, i) => addGroup(g?.rate_limit, `extra-${i + 1}`));
  }
  // A missing/invalid percentage is unknown, never "0%" or "100%".
  if (!windows.length) throw new QuotaError('schema_changed');
  const credits = object(raw.credits) ? {
    hasCredits: typeof raw.credits.has_credits === 'boolean' ? raw.credits.has_credits : null,
    unlimited: typeof raw.credits.unlimited === 'boolean' ? raw.credits.unlimited : null,
  } : null;
  return {
    plan: plans.has(raw.plan_type) ? raw.plan_type : null,
    windows,
    allowed: typeof raw.rate_limit?.allowed === 'boolean' ? raw.rate_limit.allowed : null,
    limitReached: typeof raw.rate_limit?.limit_reached === 'boolean' ? raw.rate_limit.limit_reached : null,
    credits,
  };
}

export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 60000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(5000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(5000, date - now) : 60000;
}

export async function readJson(response, maxBytes = 1048576) {
  if (!response.body) throw new QuotaError('schema_changed');
  const reader = response.body.getReader();
  let bytes = 0; const parts = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new QuotaError('schema_changed');
      parts.push(value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder().decode(joined));
  } catch (error) {
    if (error instanceof QuotaError) throw error;
    throw new QuotaError(error?.name === 'AbortError' ? 'network_error' : 'schema_changed');
  } finally { await reader.cancel().catch(() => {}); }
}

export class QuotaMonitor {
  constructor({ readGrant, fetchImpl = fetch, now = Date.now, pollIntervalMs = POLL_MS, timeoutMs = 10000 }) {
    this.readGrant = readGrant; this.fetchImpl = fetchImpl; this.now = now;
    this.pollIntervalMs = Math.max(POLL_MS, pollIntervalMs); this.timeoutMs = timeoutMs;
    this.state = { status: 'loading', errorCode: null, updatedAt: null, checkedAt: null,
      nextFetchAt: 0, pollIntervalMs: this.pollIntervalMs, plan: null, windows: [],
      allowed: null, limitReached: null, credits: null };
    this.identity = null; this.inflight = null; this.controller = null; this.failures = 0;
    this.disposed = false; this.epoch = 0;
  }
  snapshot() {
    return { ...this.state, stale: this.state.windows.length > 0 &&
      (this.state.status !== 'ok' || this.now() - this.state.updatedAt > this.pollIntervalMs * 2) };
  }
  invalidate() {
    this.epoch++; this.controller?.abort(); this.state.nextFetchAt = 0;
    this.state = { ...this.state, status: 'loading', windows: [], plan: null,
      allowed: null, limitReached: null, credits: null, updatedAt: null, errorCode: null };
  }
  async getStatus() {
    if (this.disposed) return { ...this.snapshot(), status: 'disabled' };
    if (this.inflight) { await this.inflight; return this.snapshot(); }
    if (this.now() < this.state.nextFetchAt) return this.snapshot();
    this.inflight = this.update();
    try { await this.inflight; } finally { this.inflight = null; }
    return this.snapshot();
  }
  async update() {
    const epoch = this.epoch; const startedAt = this.now();
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs); timeout.unref?.();
    try {
      const grant = await this.readGrant(controller.signal);
      if (!grant) throw new QuotaError('not_logged_in');
      if (this.identity !== grant.accountId) {
        this.identity = grant.accountId;
        this.state = { ...this.state, windows: [], plan: null, updatedAt: null, allowed: null,
          limitReached: null, credits: null };
      }
      const response = await this.fetchImpl(USAGE_URL, {
        headers: { Authorization: `Bearer ${grant.access}`, 'chatgpt-account-id': grant.accountId,
          originator: 'pi', Accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 401) throw new QuotaError('login_expired');
        if (response.status === 403) throw new QuotaError('access_denied');
        if (response.status === 429) throw new QuotaError('rate_limited', retryAfterMs(response.headers.get('retry-after'), this.now()));
        throw new QuotaError('upstream_error');
      }
      const quota = normalizeQuota(await readJson(response), this.now());
      if (this.disposed || epoch !== this.epoch) return;
      this.failures = 0;
      this.state = { ...this.state, ...quota, status: 'ok', errorCode: null,
        checkedAt: this.now(), updatedAt: this.now(), nextFetchAt: startedAt + this.pollIntervalMs };
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      const code = error instanceof QuotaError ? error.code : 'network_error';
      this.failures++;
      const delay = Math.max(error instanceof QuotaError ? error.retryMs : 0,
        Math.min(300000, this.pollIntervalMs * 2 ** Math.min(this.failures - 1, 6)));
      if (code === 'not_logged_in' || code === 'login_expired') {
        this.state = { ...this.state, windows: [], plan: null, updatedAt: null,
          allowed: null, limitReached: null, credits: null }; this.identity = null;
      }
      this.state = { ...this.state, status: code === 'not_logged_in' ? 'not_logged_in' : 'error',
        errorCode: code, checkedAt: this.now(), nextFetchAt: this.now() + delay };
    } finally { clearTimeout(timeout); if (this.controller === controller) this.controller = null; }
  }
  dispose() { this.disposed = true; this.controller?.abort(); }
}
