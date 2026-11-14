// Shared DOM and API helpers. All user text is set with textContent (never innerHTML).

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (res.status === 401 && data.sessionExpired && !location.pathname.startsWith('/login')) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

export async function currentUser() {
  try {
    return (await api('/api/me')).user;
  } catch {
    return null;
  }
}

export function rupees(n) {
  return typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—';
}

export function initials(name = '') {
  const parts = name.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function firstName(name = '') {
  return name.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').split(/\s+/)[0] || name;
}

export function formatDate(iso, withTime = false) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleString('en-IN', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
