// Server-side sessions. The browser only holds a random session id (httpOnly cookie).
// Sessions are persisted so a refresh, restart or redeploy does not log users out:
// the DB stores sha256(id) and an AES-256-GCM encrypted {token, user}, never the raw id or a readable token.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'kit_sid';
export const VISITOR_COOKIE = 'kit_vid';
const ID_PATTERN = /^[\w-]{20,64}$/;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* malformed cookie value: ignore it */
    }
  }
  return out;
}

export function newId() {
  return randomBytes(24).toString('base64url');
}

const hashId = (id) => createHash('sha256').update(id).digest('hex');

function sealer(secret, logger) {
  if (!secret) logger?.warn?.('[sessions] SESSION_SECRET is not set: using a per-process key, so restarts will log users out.');
  const key = createHash('sha256').update(secret || randomBytes(32)).digest();
  return {
    seal(obj) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    open(blob) {
      const raw = Buffer.from(blob, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    },
  };
}

/**
 * persist (optional): { saveSession(idHash, blob, expiresAtIso), loadSession(idHash) -> {data, expires_at} | null,
 * deleteSession(idHash), deleteExpiredSessions(nowIso) }. Without it, sessions live in memory only (tests).
 */
export function createSessionStore({ persist = null, secret = '', ttlMs = 8 * 60 * 60 * 1000, now = () => Date.now(), logger = console } = {}) {
  const cache = new Map();
  const crypto = sealer(secret, persist ? logger : null);

  return {
    async create(token, user, expiresInSec) {
      const id = newId();
      const ttl = Math.min(ttlMs, (expiresInSec ?? ttlMs / 1000) * 1000);
      const session = { token, user, expiresAt: now() + ttl };
      cache.set(id, session);
      await persist?.saveSession(hashId(id), crypto.seal({ token, user }), new Date(session.expiresAt).toISOString());
      return id;
    },
    async get(id) {
      if (!id || !ID_PATTERN.test(id)) return null;
      let session = cache.get(id);
      if (!session && persist) {
        try {
          const row = await persist.loadSession(hashId(id));
          if (row) session = { ...crypto.open(row.data), expiresAt: Date.parse(row.expires_at) };
        } catch (err) {
          logger.warn?.(`[sessions] could not restore a session: ${err.message}`);
        }
        if (session) cache.set(id, session);
      }
      if (!session) return null;
      if (session.expiresAt <= now()) {
        await this.destroy(id);
        return null;
      }
      return session;
    },
    async destroy(id) {
      if (!id) return;
      cache.delete(id);
      await persist?.deleteSession(hashId(id)).catch((err) => logger.warn?.(`[sessions] delete failed: ${err.message}`));
    },
    async sweep() {
      for (const [id, s] of cache) if (s.expiresAt <= now()) cache.delete(id);
      await persist?.deleteExpiredSessions(new Date(now()).toISOString()).catch(() => {});
    },
  };
}

export function cookie(name, value, { maxAgeSec, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Only same-site paths are allowed as a post-login destination (prevents open redirects). */
export function safeNextPath(next) {
  return typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) && !next.startsWith('/api') ? next : '/assistant';
}
