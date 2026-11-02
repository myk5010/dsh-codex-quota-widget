// Deliberately excludes messages, URLs, headers, bodies, identity and credentials.
export const DEBUG_LIMIT = 300;
export const DEBUG_TTL_MS = 30 * 60 * 1000;
const EVENTS = new Set(['debug_enabled','debug_disabled','debug_expired','query_started','stage',
  'upstream_headers','query_succeeded','query_failed','backoff','cache_hit','join_inflight',
  'query_cancelled','deadline_exceeded','credentials_changed','rpc_completed','refresh_headers','refresh_succeeded','refresh_failed']);
const STAGES = new Set(['credentials_read','credentials_lock','oauth_refresh','upstream_fetch','body_read','normalize','rpc']);
const ERRORS = new Set(['not_logged_in','login_expired','access_denied','rate_limited','upstream_error','schema_changed','network_error']);
const NAMES = new Set(['Error','QuotaError','TypeError','SyntaxError','AbortError','TimeoutError','ConnectTimeoutError','HeadersTimeoutError','BodyTimeoutError','SocketError']);
const NETWORK_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET',
  'UND_ERR_ABORTED','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE','ECANCELED']);
const NUMBER_FIELDS = new Set(['durationMs','elapsedMs','timeoutMs','pollIntervalMs','retryMs','failures','cacheAgeMs']);
function fields(input = {}) {
  const out = {};
  for (const key of NUMBER_FIELDS) if (typeof input[key] === 'number' && Number.isFinite(input[key]))
    out[key] = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(input[key])));
  if (typeof input.httpStatus === 'number' && input.httpStatus >= 100 && input.httpStatus <= 599) out.httpStatus = Math.trunc(input.httpStatus);
  if (typeof input.requestId === 'string' && /^q\d{1,16}$/.test(input.requestId)) out.requestId = input.requestId;
  if (STAGES.has(input.stage)) out.stage = input.stage;
  if (ERRORS.has(input.errorCode)) out.errorCode = input.errorCode;
  if (NAMES.has(input.errorName)) out.errorName = input.errorName;
  if (NAMES.has(input.causeName)) out.causeName = input.causeName;
  if (NETWORK_CODES.has(input.networkCode)) out.networkCode = input.networkCode;
  if (['json','html','text','other'].includes(input.contentType)) out.contentType = input.contentType;
  for (const key of ['timedOut','aborted','refreshNeeded']) if (typeof input[key] === 'boolean') out[key] = input[key];
  return out;
}
export function safeErrorFields(error) {
  const out = {};
  try {
    if (NAMES.has(error?.name)) out.errorName = error.name;
    if (NAMES.has(error?.cause?.name)) out.causeName = error.cause.name;
    const candidates = [error, error?.cause, error?.cause?.cause, ...(Array.isArray(error?.cause?.errors) ? error.cause.errors.slice(0, 4) : [])];
    for (const item of candidates) if (NETWORK_CODES.has(item?.code)) { out.networkCode = item.code; break; }
  } catch { /* Diagnostics must not change query behavior. */ }
  return out;
}
export function safeContentType(value) {
  const mime = typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  return mime === 'application/json' || mime.endsWith('+json') ? 'json' : mime === 'text/html' ? 'html' : mime.startsWith('text/') ? 'text' : 'other';
}
export class DebugRecorder {
  constructor({ now = Date.now, maxEntries = DEBUG_LIMIT, ttlMs = DEBUG_TTL_MS } = {}) {
    this.now = now; this.maxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.min(DEBUG_LIMIT, Math.floor(maxEntries))) : DEBUG_LIMIT;
    this.ttlMs = Number.isFinite(ttlMs) ? Math.max(1, Math.min(DEBUG_TTL_MS, ttlMs)) : DEBUG_TTL_MS; this.enabled = false;
    this.startedAt = null; this.expiresAt = null; this.generation = 0; this.seq = 0; this.entries = [];
  }
  append(event, input) {
    const entry = { source: 'host', seq: ++this.seq, timestampMs: this.now(), event, ...fields(input) };
    this.entries.push(entry); if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
  }
  expire() {
    if (this.enabled && this.now() >= this.expiresAt) { this.enabled = false; this.append('debug_expired', {}); }
  }
  enable() {
    this.expire();
    if (!this.enabled) { this.enabled = true; this.startedAt = this.now(); this.expiresAt = this.startedAt + this.ttlMs;
      this.generation++; this.seq = 0; this.entries = []; this.append('debug_enabled', {}); }
    return this.summary();
  }
  disable() { this.expire(); if (this.enabled) { this.append('debug_disabled', {}); this.enabled = false; } return this.summary(); }
  clear() { this.expire(); this.entries = []; return this.summary(); }
  record(event, input) {
    try { this.expire(); if (!this.enabled || !EVENTS.has(event)) return; this.append(event, input); } catch { /* fail open */ }
  }
  summary() {
    this.expire(); return { enabled: this.enabled, startedAt: this.startedAt, expiresAt: this.expiresAt,
      generation: this.generation, count: this.entries.length, lastSeq: this.seq, maxEntries: this.maxEntries, ttlMs: this.ttlMs };
  }
  read(limit = this.maxEntries) {
    const summary = this.summary(); const bounded = Math.max(0, Math.min(this.maxEntries, Math.floor(limit)));
    return { ...summary, entries: bounded ? this.entries.slice(-bounded).map(e => ({ ...e })) : [] };
  }
  dispose() { this.enabled = false; this.entries = []; }
}
