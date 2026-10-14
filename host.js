import z from '@deepseek-ai/schemastery';
import { QuotaError, QuotaMonitor, TOKEN_URL, readJson } from './monitor.js';

export const name = 'codex-quota';
export const inject = ['credentials', 'connection'];
export const Config = z.object({
  pollIntervalMs: z.number().min(5000).max(60000).default(5000),
  timeoutMs: z.number().min(1000).max(30000).default(10000),
});
const RECORD_KEY = 'llm-pi-ai/openai-codex';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export function validGrant(record) {
  const p = record?.kind === 'grant' ? record.payload : null;
  return p?.type === 'oauth' && typeof p.access === 'string' && p.access.length > 0 &&
    typeof p.accountId === 'string' && p.accountId.length > 0 &&
    typeof p.expires === 'number' && Number.isFinite(p.expires) ? p : null;
}

export async function refreshGrant(grant, signal, fetchImpl = fetch, now = Date.now) {
  if (typeof grant.refresh !== 'string' || !grant.refresh) throw new QuotaError('login_expired');
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: grant.refresh }),
  });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new QuotaError('login_expired'); }
  const data = await readJson(response);
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' ||
    !data.refresh_token || typeof data.expires_in !== 'number' || data.expires_in <= 0)
    throw new QuotaError('login_expired');
  let accountId;
  try { accountId = JSON.parse(Buffer.from(data.access_token.split('.')[1], 'base64url').toString())
    ['https://api.openai.com/auth']?.chatgpt_account_id; } catch { /* retain the prior account if no claim */ }
  return { ...grant, access: data.access_token, refresh: data.refresh_token,
    expires: now() + data.expires_in * 1000,
    accountId: typeof accountId === 'string' && accountId ? accountId : grant.accountId };
}

export function apply(ctx, config = {}) {
  let refreshing = false;
  const monitor = new QuotaMonitor({
    pollIntervalMs: config.pollIntervalMs ?? 5000,
    timeoutMs: config.timeoutMs ?? 10000,
    async readGrant(signal) {
      let grant = validGrant(await ctx.credentials.readRecord(RECORD_KEY));
      if (!grant) return null;
      signal.throwIfAborted();
      if (grant.expires > Date.now() + 60000) return grant;
      // Same DSH credentials lock as the model adapter: never rotate tokens outside its seam.
      refreshing = true;
      try {
        const record = await ctx.credentials.modifyRecord(RECORD_KEY, async current => {
          const latest = validGrant(current);
          if (!latest) return current; // do not recreate a deleted login
          signal.throwIfAborted();
          if (latest.expires > Date.now() + 60000) return current;
          const payload = await refreshGrant(latest, signal);
          // Once OpenAI has returned rotated tokens, always persist them under the lock.
          // A concurrent plugin unload may cancel the quota read, but must not lose the login.
          return { kind: 'grant', payload };
        });
        grant = validGrant(record);
        if (!grant) throw new QuotaError('not_logged_in');
        return grant;
      } finally { refreshing = false; }
    },
  });
  ctx.on('credentials/record-updated', key => {
    if (key === RECORD_KEY && !refreshing) monitor.invalidate();
  });
  ctx.effect(() => {
    // An exact authenticated Fetch route precedes the application's singleton RPC interceptor.
    // Keep Connection's RPC envelope so the client can use its existing rpc.call() carrier.
    const remove = ctx.connection.fetch.register({
      path: '/api/codex-quota/status', methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
          return new Response('application/json required', { status: 415 });
        let message;
        try { message = await readJson(request, 4096); } catch { return new Response('invalid request', { status: 400 }); }
        if (message?.type !== 'client-request' || message.method !== 'codex-quota/status' ||
          typeof message.rpcId !== 'string' || !message.rpcId || message.rpcId.length > 128)
          return new Response('invalid request', { status: 400 });
        return Response.json({ type: 'server-response', rpcId: message.rpcId,
          result: { ok: true, value: await monitor.getStatus() } },
          { headers: { 'Cache-Control': 'no-store' } });
      },
    });
    return async () => { monitor.dispose(); await remove(); };
  });
}
