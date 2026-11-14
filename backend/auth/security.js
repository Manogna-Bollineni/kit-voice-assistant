// Server-side sessions. The college JWT stays on the server; the browser only holds a random session id.
import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'kit_sid';
export const VISITOR_COOKIE = 'kit_vid';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function newId() {
  return randomBytes(24).toString('base64url');
}

export function createSessionStore({ ttlMs = 8 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const sessions = new Map();
  return {
    create(token, user, expiresInSec) {
      const id = newId();
      const ttl = Math.min(ttlMs, (expiresInSec ?? ttlMs / 1000) * 1000);
      sessions.set(id, { token, user, expiresAt: now() + ttl });
      return id;
    },
    get(id) {
      const s = id && sessions.get(id);
      if (!s) return null;
      if (s.expiresAt <= now()) {
        sessions.delete(id);
        return null;
      }
      return s;
    },
    destroy(id) {
      sessions.delete(id);
    },
    sweep() {
      for (const [id, s] of sessions) if (s.expiresAt <= now()) sessions.delete(id);
    },
  };
}

export function cookie(name, value, { maxAgeSec, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
