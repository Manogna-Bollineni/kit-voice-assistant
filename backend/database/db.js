// Conversation history storage: Postgres when DATABASE_URL is set (production), SQLite file otherwise.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
     id TEXT PRIMARY KEY,
     owner TEXT NOT NULL,
     mode TEXT NOT NULL,
     title TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(owner, updated_at)`,
  `CREATE TABLE IF NOT EXISTS messages (
     id TEXT PRIMARY KEY,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     meta TEXT,
     created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id_hash TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     expires_at TEXT NOT NULL)`,
];

// Records the assistant created or changed in the college system, with columns taken from the API schemas
// (UserSummary, AdmissionApplicationResponse, RequestResponse, PlacementRegistrationResponse). Keyed by the college id.
export const RECORD_TABLES = {
  users: { id: 'INTEGER', login_id: 'TEXT', full_name: 'TEXT', role: 'TEXT', department: 'TEXT', class_id: 'INTEGER', class_code: 'TEXT', programme: 'TEXT', year_of_study: 'INTEGER' },
  admission_applications: { id: 'INTEGER', full_name: 'TEXT', phone: 'TEXT', email: 'TEXT', course_code: 'TEXT', twelfth_percent: 'REAL', status: 'TEXT', created_at: 'TEXT' },
  requests: {
    id: 'INTEGER', student_id: 'INTEGER', student_name: 'TEXT', class_code: 'TEXT', type: 'TEXT', from_date: 'TEXT', to_date: 'TEXT', half_day: 'INTEGER',
    reason: 'TEXT', event_name: 'TEXT', status: 'TEXT', decided_by: 'INTEGER', decision_note: 'TEXT', created_at: 'TEXT',
  },
  placement_registrations: { id: 'INTEGER', drive_id: 'INTEGER', company: 'TEXT', student_id: 'INTEGER', registered_at: 'TEXT' },
};

for (const [table, cols] of Object.entries(RECORD_TABLES)) {
  const defs = Object.entries(cols).map(([c, type]) => (c === 'id' ? 'id INTEGER PRIMARY KEY' : `${c} ${type}`));
  SCHEMA.push(`CREATE TABLE IF NOT EXISTS ${table} (${defs.join(', ')}, conversation_id TEXT, saved_at TEXT NOT NULL)`);
}

function upsertSql(table) {
  const cols = [...Object.keys(RECORD_TABLES[table]), 'conversation_id', 'saved_at'];
  const updates = cols.filter((c) => c !== 'id' && c !== 'conversation_id').map((c) => `${c} = EXCLUDED.${c}`);
  return {
    cols,
    sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
          ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}`,
  };
}

const toColumn = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);

function api(q) {
  const now = () => new Date().toISOString();
  const parseMsg = (r) => ({ id: r.id, role: r.role, text: r.text, createdAt: r.created_at, ...(r.meta ? JSON.parse(r.meta) : {}) });
  return {
    async createConversation(owner, mode, firstText) {
      const id = randomUUID();
      const ts = now();
      const title = firstText.trim().slice(0, 80) || 'Conversation';
      await q.run('INSERT INTO conversations (id, owner, mode, title, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, owner, mode, title, ts, ts]);
      return { id, owner, mode, title, createdAt: ts };
    },
    async getConversation(owner, id) {
      const r = await q.get('SELECT * FROM conversations WHERE id = $1 AND owner = $2', [id, owner]);
      return r ? { id: r.id, owner: r.owner, mode: r.mode, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at } : null;
    },
    async addMessage(conversationId, role, text, meta = null) {
      const ts = now();
      await q.run('INSERT INTO messages (id, conversation_id, role, text, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        randomUUID(), conversationId, role, text, meta ? JSON.stringify(meta) : null, ts,
      ]);
      await q.run('UPDATE conversations SET updated_at = $1 WHERE id = $2', [ts, conversationId]);
    },
    async recentMessages(conversationId, limit = 12) {
      const rows = await q.all('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [conversationId, limit]);
      return rows.reverse().map(parseMsg);
    },
    async listConversations(owner, limit = 50) {
      const rows = await q.all(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
           FROM conversations c WHERE owner = $1 ORDER BY updated_at DESC LIMIT $2`,
        [owner, limit],
      );
      return rows.map((r) => ({ id: r.id, mode: r.mode, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, messageCount: Number(r.message_count) }));
    },
    async messages(conversationId) {
      const rows = await q.all('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC', [conversationId]);
      return rows.map(parseMsg);
    },
    /** Insert or update one college record (by its college id). Unknown tables or records without an id are ignored. */
    async saveRecord(table, data, conversationId = null) {
      if (!RECORD_TABLES[table] || data?.id == null) return false;
      const { cols, sql } = upsertSql(table);
      const values = cols.map((c) => (c === 'conversation_id' ? conversationId : c === 'saved_at' ? now() : toColumn(data[c])));
      await q.run(sql, values);
      return true;
    },
    // Sessions (see auth/security.js): keyed by sha256(session id), data is encrypted.
    async saveSession(idHash, data, expiresAt) {
      await q.run(
        'INSERT INTO sessions (id_hash, data, expires_at) VALUES ($1,$2,$3) ON CONFLICT (id_hash) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at',
        [idHash, data, expiresAt],
      );
    },
    loadSession: (idHash) => q.get('SELECT data, expires_at FROM sessions WHERE id_hash = $1', [idHash]),
    deleteSession: (idHash) => q.run('DELETE FROM sessions WHERE id_hash = $1', [idHash]),
    deleteExpiredSessions: (nowIso) => q.run('DELETE FROM sessions WHERE expires_at <= $1', [nowIso]),
    async records(table, limit = 100) {
      if (!RECORD_TABLES[table]) throw new Error(`Unknown table ${table}`);
      return q.all(`SELECT * FROM ${table} ORDER BY saved_at DESC LIMIT $1`, [limit]);
    },
    close: () => q.close(),
  };
}

export async function openSqliteStore(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const s of SCHEMA) db.exec(s);
  const prep = (sql) => db.prepare(sql.replace(/\$\d+/g, '?'));
  return api({
    run: async (sql, p) => prep(sql).run(...p),
    get: async (sql, p) => prep(sql).get(...p),
    all: async (sql, p) => prep(sql).all(...p),
    close: async () => db.close(),
  });
}

export async function openPostgresStore(connectionString, useSsl = false) {
  const { default: pg } = await import('pg');
  // SSL only when asked (DATABASE_SSL=true): docker-compose and Render's internal network use plain connections.
  const pool = new pg.Pool({ connectionString, max: 5, ssl: useSsl ? { rejectUnauthorized: false } : false });
  for (const s of SCHEMA) await pool.query(s);
  return api({
    run: async (sql, p) => pool.query(sql, p),
    get: async (sql, p) => (await pool.query(sql, p)).rows[0],
    all: async (sql, p) => (await pool.query(sql, p)).rows,
    close: () => pool.end(),
  });
}

export function openStore({ databaseUrl, databaseSsl, sqlitePath }) {
  return databaseUrl ? openPostgresStore(databaseUrl, databaseSsl) : openSqliteStore(sqlitePath);
}
