// Client for the KIT college system API. One place for headers, timeouts, retries and error shape.

export class KitApiError extends Error {
  constructor(status, code, message, field = null) {
    super(message);
    this.name = 'KitApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

function errorFromBody(status, data) {
  const e = data?.error;
  if (e) return new KitApiError(status, e.code || `http_${status}`, e.message || 'College system error', e.field ?? null);
  if (Array.isArray(data?.detail)) {
    const msg = data.detail.map((d) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ');
    return new KitApiError(status, 'validation_error', msg || 'Invalid request');
  }
  if (typeof data?.detail === 'string') return new KitApiError(status, `http_${status}`, data.detail);
  return new KitApiError(status, `http_${status}`, `College system returned status ${status}`);
}

export function createKitClient({ baseUrl, participantKey, timeoutMs = 10000, fetchImpl = fetch }) {
  async function once(method, path, { token, query, body, idempotencyKey, binary } = {}) {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const headers = { 'X-Participant-Key': participantKey, Accept: binary ? 'application/pdf' : 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new KitApiError(503, 'unreachable', 'The college system is not reachable right now.');
    }
    if (binary && res.ok) return new Uint8Array(await res.arrayBuffer());
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    if (!res.ok) throw errorFromBody(res.status, data);
    return data;
  }

  async function request(method, path, opts = {}) {
    try {
      return await once(method, path, opts);
    } catch (err) {
      // Reads are safe to retry once; writes rely on Idempotency-Key instead.
      const retryable = err instanceof KitApiError && (err.status >= 500 || err.code === 'unreachable');
      if (method === 'GET' && retryable) return once(method, path, opts);
      throw err;
    }
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
    login: (loginId, password) => request('POST', '/v1/auth/login', { body: { login_id: loginId, password } }),
  };
}
