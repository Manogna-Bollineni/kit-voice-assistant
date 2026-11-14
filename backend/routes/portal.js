// Logged-in portal routes for the UI cards: student overview (next exam, attendance) and teacher approvals.
import express from 'express';
import { randomUUID } from 'node:crypto';
import { KitApiError } from '../services/collegeApi.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (isoDate, n) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function registerPortalRoutes(app, { kit, store, sessions, logger = console }) {
  const json = express.json({ limit: '10kb' });

  function requireRole(role) {
    return (req, res, next) => {
      if (!req.session) return res.status(401).json({ error: 'Please log in.', sessionExpired: true });
      if (role && req.session.user.role !== role) return res.status(403).json({ error: 'Not available for your account.' });
      next();
    };
  }

  function sendKitError(req, res, err) {
    if (err instanceof KitApiError) {
      if (err.status === 401) {
        sessions.destroy(req.sid);
        return res.status(401).json({ error: 'Your session has expired. Please log in again.', sessionExpired: true });
      }
      return res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message, code: err.code });
    }
    logger.error('[portal]', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  app.get('/api/overview', requireRole(), async (req, res) => {
    const { token, user } = req.session;
    try {
      if (user.role === 'teacher') {
        const pending = await kit.get('/v1/teacher/requests', { token, query: { status: 'pending' } });
        return res.json({ role: 'teacher', pendingCount: Array.isArray(pending) ? pending.length : 0 });
      }
      const today = (await kit.get('/v1/today'))?.date;
      const [calendar, attendance] = await Promise.all([
        kit.get('/v1/calendar', { token, query: { from: today, to: today ? addDays(today, 90) : undefined } }),
        kit.get('/v1/me/attendance', { token }).catch(() => null),
      ]);
      const nextExam = (Array.isArray(calendar) ? calendar : [])
        .filter((e) => e.type === 'internal_exam' && e.status !== 'cancelled' && (!today || e.date >= today))
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      res.json({
        role: 'student',
        today,
        nextExam: nextExam ? { date: nextExam.date, title: nextExam.title, subject_code: nextExam.subject_code } : null,
        attendance: attendance?.overall_percentage ?? null,
      });
    } catch (err) {
      sendKitError(req, res, err);
    }
  });

  app.get('/api/teacher/requests', requireRole('teacher'), async (req, res) => {
    try {
      const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : 'pending';
      const list = await kit.get('/v1/teacher/requests', { token: req.session.token, query: { status } });
      res.json({ requests: Array.isArray(list) ? list : [] });
    } catch (err) {
      sendKitError(req, res, err);
    }
  });

  // A button click is an explicit decision, so these call the college system directly (no voice confirmation step).
  app.post('/api/teacher/requests/:id/:decision', requireRole('teacher'), json, async (req, res) => {
    const id = Number(req.params.id);
    const { decision } = req.params;
    if (!Number.isInteger(id) || !['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Invalid request.' });
    const reason = String(req.body?.reason ?? '').trim();
    if (decision === 'reject' && !reason) return res.status(400).json({ error: 'Please give a reason for rejecting.' });
    try {
      const body = decision === 'approve' ? { comment: String(req.body?.comment ?? '').trim() || null } : { reason: reason.slice(0, 500) };
      const result = await kit.post(`/v1/teacher/requests/${id}/${decision}`, { token: req.session.token, body, idempotencyKey: randomUUID() });
      await store.saveRecord('requests', result).catch((err) => logger.error(`[portal record] ${err.message}`));
      res.json({ request: result });
    } catch (err) {
      sendKitError(req, res, err);
    }
  });
}
