import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KitApiError } from './services/collegeApi.js';
import { AgentUnavailableError } from './agent/orchestrator.js';
import { recentActionNotes } from './services/history.js';
import { SttUnavailableError } from './voice/stt.js';
import { SESSION_COOKIE, VISITOR_COOKIE, cookie, newId, parseCookies } from './auth/security.js';

const FRONTEND_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const PAGES = { '/': 'index.html', '/login': 'login.html', '/assistant': 'assistant.html', '/history': 'history.html' };
const MAX_TEXT = 1000;
const HISTORY_TURNS = 12;

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const entry = hits.get(key) ?? { count: 0, reset: now + windowMs };
    if (entry.reset <= now) Object.assign(entry, { count: 0, reset: now + windowMs });
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    next();
  };
}

function publicUser(u) {
  if (!u) return null;
  const { id, login_id, full_name, role, department, class_code, programme, year_of_study } = u;
  return { id, login_id, full_name, role, department, class_code, programme, year_of_study };
}

export function createApp({ kit, agent, transcriber, store, sessions, knowledge, secureCookies = false, logger = console }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    next();
  });

  // Identity: logged-in session (if any) plus an anonymous visitor id for public history.
  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    req.sid = cookies[SESSION_COOKIE];
    req.session = sessions.get(req.sid);
    let vid = cookies[VISITOR_COOKIE];
    if (!vid || !/^[\w-]{20,64}$/.test(vid)) {
      vid = newId();
      res.append('Set-Cookie', cookie(VISITOR_COOKIE, vid, { maxAgeSec: 60 * 60 * 24 * 180, secure: secureCookies }));
    }
    req.visitorId = vid;
    req.owner = req.session ? `user:${req.session.user.login_id}` : `visitor:${vid}`;
    next();
  });

  const json = express.json({ limit: '20kb' });
  const turnLimit = rateLimit({ windowMs: 60_000, max: 30 });

  // College system status from its own /v1/health, cached briefly; our app stays "ok" even if it is down.
  let collegeHealth = { at: 0, value: null };
  async function collegeStatus() {
    if (Date.now() - collegeHealth.at < 30_000) return collegeHealth.value;
    let value;
    try {
      const h = await kit.get('/v1/health');
      value = { reachable: true, status: h?.status ?? 'unknown', version: h?.version ?? null };
    } catch (err) {
      value = { reachable: false, error: err.message };
    }
    collegeHealth = { at: Date.now(), value };
    return value;
  }

  app.get('/api/health', async (req, res) => {
    res.json({
      ok: true,
      ai: agent.hasProviders(),
      speech: transcriber.available(),
      documents: knowledge.status().documents.length,
      collegeSystem: await collegeStatus(),
    });
  });

  let homeCache = { at: 0, data: null };
  app.get('/api/public/home', async (req, res) => {
    if (!homeCache.data || Date.now() - homeCache.at > 300_000) {
      try {
        const [college, courses] = await Promise.all([kit.get('/v1/college'), kit.get('/v1/courses')]);
        homeCache = { at: Date.now(), data: { college, courses } };
      } catch (err) {
        logger.error(`[home] ${err.message}`);
        if (!homeCache.data) return res.status(502).json({ error: 'College information is not available right now.' });
      }
    }
    res.json(homeCache.data);
  });

  app.post('/api/auth/login', rateLimit({ windowMs: 60_000, max: 10 }), json, async (req, res) => {
    const loginId = String(req.body?.login_id ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!loginId || !password || loginId.length > 64 || password.length > 128) {
      return res.status(400).json({ error: 'Enter your login ID and password.' });
    }
    try {
      const out = await kit.login(loginId, password);
      if (!out?.access_token || !out?.user) throw new KitApiError(502, 'bad_login_response', 'Unexpected login response');
      if (req.session) sessions.destroy(req.sid);
      const sid = sessions.create(out.access_token, out.user, out.expires_in);
      await store.saveRecord('users', out.user).catch((err) => logger.error(`[users] ${err.message}`));
      res.append('Set-Cookie', cookie(SESSION_COOKIE, sid, { maxAgeSec: out.expires_in ?? 28800, secure: secureCookies }));
      res.json({ user: publicUser(out.user) });
    } catch (err) {
      if (err instanceof KitApiError && (err.status === 401 || err.status === 400 || err.status === 422)) {
        return res.status(401).json({ error: 'Login ID or password is incorrect.' });
      }
      logger.error(`[login] ${err.message}`);
      res.status(502).json({ error: 'Could not reach the college system. Please try again.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sid) sessions.destroy(req.sid);
    res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure: secureCookies }));
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ user: publicUser(req.session?.user) }));

  async function runTurn(req, res, text, extra = {}) {
    const wantMember = (req.query.mode ?? req.body?.mode) === 'member';
    if (wantMember && !req.session) return res.status(401).json({ error: 'Please log in again.', sessionExpired: true });
    const role = wantMember ? req.session.user.role : 'public';
    const mode = wantMember ? 'member' : 'public';

    const requestedId = String(req.query.conversationId ?? req.body?.conversationId ?? '');
    let conversation = requestedId ? await store.getConversation(req.owner, requestedId) : null;
    if (conversation && conversation.mode !== mode) conversation = null;
    if (!conversation) conversation = await store.createConversation(req.owner, mode, text);

    const past = await store.recentMessages(conversation.id, HISTORY_TURNS);
    const history = past.map((m) => ({ role: m.role, text: m.text }));
    let sessionExpired = false;
    let result;
    try {
      result = await agent.respond({
        role,
        user: wantMember ? req.session.user : null,
        token: wantMember ? req.session.token : null,
        text,
        history,
        recentActions: recentActionNotes(past),
        conversationId: conversation.id,
        onRecord: (table, data) => store.saveRecord(table, data, conversation.id),
        onUnauthorized: () => {
          sessionExpired = true;
          sessions.destroy(req.sid);
        },
      });
    } catch (err) {
      if (!(err instanceof AgentUnavailableError)) throw err;
      logger.error(`[turn] ${err.message}`);
      result = { text: 'Sorry, the assistant is unavailable right now. Please try again in a minute.', actions: [], provider: 'none', failed: true };
    }

    await store.addMessage(conversation.id, 'user', text, extra.sttProvider ? { sttProvider: extra.sttProvider } : null);
    await store.addMessage(conversation.id, 'assistant', result.text, { provider: result.provider, actions: result.actions });
    res.status(result.failed ? 503 : 200).json({
      conversationId: conversation.id,
      transcript: text,
      reply: result.text,
      provider: result.provider,
      sttProvider: extra.sttProvider ?? null,
      actions: result.actions.map((a) => ({ name: a.name, ok: a.ok, write: a.write })),
      sessionExpired,
    });
  }

  app.post('/api/assistant/text', turnLimit, json, async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'Say or type something first.' });
    if (text.length > MAX_TEXT) return res.status(413).json({ error: 'That message is too long.' });
    await runTurn(req, res, text);
  });

  app.post(
    '/api/assistant/voice',
    turnLimit,
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '10mb' }),
    async (req, res) => {
      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length < 1000) {
        return res.status(400).json({ error: 'No audio received. Hold the button a little longer.', reply: "I didn't hear anything. Please try again." });
      }
      if (!transcriber.available()) return res.status(503).json({ error: 'Speech service is not configured.', reply: 'Voice input is unavailable; please type instead.' });
      let transcript;
      try {
        transcript = await transcriber.transcribe(audio, req.headers['content-type'] || 'audio/webm');
      } catch (err) {
        if (!(err instanceof SttUnavailableError)) throw err;
        return res.status(503).json({ error: err.message, reply: "Sorry, I couldn't process the audio. Please try again or type your question." });
      }
      const text = transcript.text.slice(0, MAX_TEXT);
      if (!text) return res.json({ transcript: '', reply: "Sorry, I didn't catch that. Could you say it again?", conversationId: req.query.conversationId ?? null, actions: [] });
      await runTurn(req, res, text, { sttProvider: transcript.provider });
    },
  );

  app.get('/api/history', async (req, res) => {
    res.json({ conversations: await store.listConversations(req.owner) });
  });

  app.get('/api/history/:id', async (req, res) => {
    const conversation = await store.getConversation(req.owner, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
    const messages = (await store.messages(conversation.id)).map((m) => ({
      role: m.role,
      text: m.text,
      createdAt: m.createdAt,
      actions: (m.actions ?? []).map((a) => ({ name: a.name, ok: a.ok })),
    }));
    res.json({ conversation, messages });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  for (const [route, page] of Object.entries(PAGES)) {
    app.get(route, (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', page)));
  }
  app.get(['/favicon.svg', '/favicon.ico'], (req, res) => {
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').sendFile(path.join(FRONTEND_DIR, 'favicon.svg'));
  });
  for (const dir of ['pages', 'components', 'services', 'styles']) {
    app.use(`/${dir}`, express.static(path.join(FRONTEND_DIR, dir), { index: false }));
  }

  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large.' });
    logger.error('[error]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
