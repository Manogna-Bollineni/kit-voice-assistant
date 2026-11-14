export const silentLogger = { info() {}, warn() {}, error() {} };

/** Fake fetch that routes by "METHOD /path" and records calls. */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? 'GET'} ${u.pathname}`;
    calls.push({ key, url: u, init });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no route' } }), { status: 404 });
    const out = typeof handler === 'function' ? await handler(u, init, calls) : handler;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out.body ?? out), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
