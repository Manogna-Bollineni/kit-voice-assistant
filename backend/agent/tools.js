// Assistant actions. Each tool declares which roles may use it; the server enforces this, not the model.
import { createHash } from 'node:crypto';
import { KitApiError } from '../services/collegeApi.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RESULT_CHARS = 12000;

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description) => ({ type: 'integer', description });
const CONFIRMED = {
  type: 'boolean',
  description: 'Set true only after you read the details back to the user and they clearly said yes in their latest message.',
};

class ToolInputError extends Error {}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Timetable as one line per weekday plus a subject legend: same facts, a fraction of the tokens. */
export function compactTimetable(slots) {
  if (!Array.isArray(slots)) return slots;
  const subjects = {};
  const days = {};
  for (const s of [...slots].sort((a, b) => a.weekday - b.weekday || a.period - b.period)) {
    subjects[s.subject_code] = s.subject_name;
    const day = DAY[s.weekday] ?? `Day${s.weekday}`;
    (days[day] ??= []).push(`P${s.period} ${s.start_time}-${s.end_time} ${s.subject_code}`);
  }
  return { subjects, periods_by_weekday: Object.fromEntries(Object.entries(days).map(([d, list]) => [d, list.join(', ')])) };
}

function need(cond, message) {
  if (!cond) throw new ToolInputError(message);
}

function requireConfirmed(args) {
  need(args.user_confirmed === true, 'Not submitted. Read the details back to the user and ask them to confirm first.');
}

function idempotencyKey(ctx, name, args) {
  const { user_confirmed: _ignored, ...rest } = args;
  return createHash('sha256')
    .update(JSON.stringify([ctx.conversationId, ctx.user?.login_id ?? 'visitor', name, rest]))
    .digest('hex')
    .slice(0, 40);
}

const PUBLIC = ['public'];
const STUDENT = ['student'];
const TEACHER = ['teacher'];
const EVERYONE = ['public', 'student', 'teacher'];
const MEMBERS = ['student', 'teacher'];

export const TOOLS = [
  {
    name: 'get_today',
    roles: EVERYONE,
    description: "Get the college's current date and weekday (the college calendar date, which may differ from the real date). Use it before working out relative dates like 'tomorrow' or 'next Monday'.",
    input_schema: { type: 'object', properties: {} },
    run: ({ kit }) => kit.get('/v1/today'),
  },
  {
    name: 'get_college_info',
    roles: EVERYONE,
    description: 'Get the official college name, description and admissions contact details.',
    input_schema: { type: 'object', properties: {} },
    run: ({ kit }) => kit.get('/v1/college'),
  },
  {
    name: 'list_courses',
    roles: EVERYONE,
    description: 'List B.Tech programmes with course code, minimum 12th percentage, annual tuition fee, hostel fee and seats. This live data is authoritative for fees, cut-offs and seats.',
    input_schema: { type: 'object', properties: {} },
    run: ({ kit }) => kit.get('/v1/courses'),
  },
  {
    name: 'submit_admission_application',
    roles: PUBLIC,
    write: true,
    description: 'Submit an admission application for one programme. First check the applicant meets the minimum 12th percentage for that course (list_courses). Collect all fields, read them back, and get a clear yes before calling.',
    input_schema: {
      type: 'object',
      properties: {
        full_name: str('Applicant full name'),
        phone: str('Mobile number, e.g. +91 9876543210'),
        email: str('Email address'),
        course_code: str('Course code, e.g. BTECH-CSE'),
        twelfth_percent: { type: 'number', description: '12th PCM aggregate percentage (or expected percentage if results are awaited)' },
        user_confirmed: CONFIRMED,
      },
      required: ['full_name', 'phone', 'email', 'course_code', 'twelfth_percent', 'user_confirmed'],
    },
    run: ({ kit }, a, key) => {
      requireConfirmed(a);
      need(a.full_name?.trim(), 'full_name is required');
      need(/^\+?[\d\s-]{8,16}$/.test(a.phone ?? ''), 'phone looks invalid; ask the user to repeat it');
      need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email ?? ''), 'email looks invalid; ask the user to spell it');
      need(typeof a.twelfth_percent === 'number' && a.twelfth_percent >= 0 && a.twelfth_percent <= 100, 'twelfth_percent must be 0-100');
      const body = {
        full_name: a.full_name.trim(),
        phone: a.phone.trim(),
        email: a.email.trim().toLowerCase(),
        course_code: String(a.course_code).trim().toUpperCase(),
        twelfth_percent: a.twelfth_percent,
      };
      return kit.post('/v1/admissions/applications', { body, idempotencyKey: key });
    },
  },
  {
    name: 'list_placement_drives',
    roles: EVERYONE,
    description: 'List active campus placement drives with company, dream/non-dream category, minimum CGPA, arrears allowed, departments, eligible years, deadline and seats left.',
    input_schema: { type: 'object', properties: {} },
    run: ({ kit }) => kit.get('/v1/placements/drives'),
  },
  {
    name: 'get_my_profile',
    roles: MEMBERS,
    description: "Get the logged-in user's profile: name, role, department, class, programme (UG = B.Tech, PG = M.Tech) and year of study.",
    input_schema: { type: 'object', properties: {} },
    run: ({ kit, token }) => kit.get('/v1/me', { token }),
  },
  {
    name: 'get_calendar',
    roles: MEMBERS,
    description: 'Get college calendar events (holidays, internal exams, declared working days) optionally between two dates (YYYY-MM-DD). Use it to check for internal assessments before personal leave.',
    input_schema: {
      type: 'object',
      properties: { from: str('Start date YYYY-MM-DD (optional)'), to: str('End date YYYY-MM-DD (optional)') },
    },
    run: ({ kit, token }, a) => {
      need(!a.from || DATE.test(a.from), 'from must be YYYY-MM-DD');
      need(!a.to || DATE.test(a.to), 'to must be YYYY-MM-DD');
      return kit.get('/v1/calendar', { token, query: { from: a.from, to: a.to } });
    },
  },
  {
    name: 'get_my_academics',
    roles: STUDENT,
    description: "Get the student's CGPA, number of standing arrears and placement status.",
    input_schema: { type: 'object', properties: {} },
    run: ({ kit, token }) => kit.get('/v1/me/academics', { token }),
  },
  {
    name: 'get_my_subjects',
    roles: STUDENT,
    description: "List the student's subjects with course codes.",
    input_schema: { type: 'object', properties: {} },
    run: ({ kit, token }) => kit.get('/v1/me/subjects', { token }),
  },
  {
    name: 'get_my_timetable',
    roles: STUDENT,
    description: "Get the student's weekly timetable (weekday 1=Mon..6=Sat, period, times, subject). Needed to work out how a leave day affects attendance.",
    input_schema: { type: 'object', properties: {} },
    run: async ({ kit, token }) => compactTimetable(await kit.get('/v1/me/timetable', { token })),
  },
  {
    name: 'get_my_attendance',
    roles: STUDENT,
    description: 'Get attendance per subject and overall as of today: periods held, attended, on-duty, absent and percentage.',
    input_schema: { type: 'object', properties: {} },
    run: ({ kit, token }) => kit.get('/v1/me/attendance', { token }),
  },
  {
    name: 'get_attendance_sessions',
    roles: STUDENT,
    description: 'Get period-by-period attendance history, optionally filtered by subject code and date range.',
    input_schema: {
      type: 'object',
      properties: {
        subject: str('Subject code, e.g. CS304 (optional)'),
        from: str('Start date YYYY-MM-DD (optional)'),
        to: str('End date YYYY-MM-DD (optional)'),
      },
    },
    run: ({ kit, token }, a) => {
      need(!a.from || DATE.test(a.from), 'from must be YYYY-MM-DD');
      need(!a.to || DATE.test(a.to), 'to must be YYYY-MM-DD');
      return kit.get('/v1/me/attendance/sessions', { token, query: { subject: a.subject, from: a.from, to: a.to } });
    },
  },
  {
    name: 'list_my_requests',
    roles: STUDENT,
    description: "List the student's leave and on-duty requests with id, type, dates, status and decision notes.",
    input_schema: { type: 'object', properties: {} },
    run: ({ kit, token }) => kit.get('/v1/me/requests', { token }),
  },
  {
    name: 'get_my_request',
    roles: STUDENT,
    description: 'Get one of the student’s own requests by id.',
    input_schema: { type: 'object', properties: { id: int('Request id') }, required: ['id'] },
    run: ({ kit, token }, a) => {
      need(Number.isInteger(a.id), 'id must be an integer');
      return kit.get(`/v1/me/requests/${a.id}`, { token });
    },
  },
  {
    name: 'submit_leave_or_od_request',
    roles: STUDENT,
    write: true,
    description: 'Submit a personal_leave, medical_leave or on_duty request for the logged-in student. Before calling: check the calendar for internal exams on those dates, and for personal leave tell the user the effect on attendance. on_duty needs event_name. Read the details back and get a clear yes.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['personal_leave', 'medical_leave', 'on_duty'] },
        from_date: str('YYYY-MM-DD'),
        to_date: str('YYYY-MM-DD'),
        half_day: { type: 'boolean', description: 'True for half-day leave (one day only)' },
        reason: str('Reason in the user’s words'),
        event_name: str('Event name (required for on_duty)'),
        user_confirmed: CONFIRMED,
      },
      required: ['type', 'from_date', 'to_date', 'reason', 'user_confirmed'],
    },
    run: ({ kit, token }, a, key) => {
      requireConfirmed(a);
      need(['personal_leave', 'medical_leave', 'on_duty'].includes(a.type), 'type must be personal_leave, medical_leave or on_duty');
      need(DATE.test(a.from_date ?? '') && DATE.test(a.to_date ?? ''), 'dates must be YYYY-MM-DD');
      need(a.from_date <= a.to_date, 'from_date must be on or before to_date');
      need(a.reason?.trim(), 'reason is required');
      need(a.type !== 'on_duty' || a.event_name?.trim(), 'event_name is required for on_duty');
      need(!a.half_day || a.from_date === a.to_date, 'half-day leave must be a single day');
      const body = {
        type: a.type,
        from_date: a.from_date,
        to_date: a.to_date,
        half_day: Boolean(a.half_day),
        reason: a.reason.trim(),
        event_name: a.type === 'on_duty' ? a.event_name.trim() : null,
      };
      return kit.post('/v1/me/requests', { token, body, idempotencyKey: key });
    },
  },
  {
    name: 'cancel_my_request',
    roles: STUDENT,
    write: true,
    description: 'Cancel one of the student’s pending or approved requests before it starts. Look the id up with list_my_requests; confirm with the user first.',
    input_schema: { type: 'object', properties: { id: int('Request id'), user_confirmed: CONFIRMED }, required: ['id', 'user_confirmed'] },
    run: ({ kit, token }, a) => {
      requireConfirmed(a);
      need(Number.isInteger(a.id), 'id must be an integer');
      return kit.post(`/v1/me/requests/${a.id}/cancel`, { token });
    },
  },
  {
    name: 'register_for_placement_drive',
    roles: STUDENT,
    write: true,
    description: 'Register the student for a placement drive by drive id. First check eligibility (CGPA, arrears, department, year, deadline, seats) using list_placement_drives and get_my_academics; confirm with the user.',
    input_schema: { type: 'object', properties: { drive_id: int('Drive id'), user_confirmed: CONFIRMED }, required: ['drive_id', 'user_confirmed'] },
    run: ({ kit, token }, a) => {
      requireConfirmed(a);
      need(Number.isInteger(a.drive_id), 'drive_id must be an integer');
      return kit.post(`/v1/placements/drives/${a.drive_id}/register`, { token });
    },
  },
  {
    name: 'list_my_placements',
    roles: STUDENT,
    description: 'List the placement drives the student has registered for.',
    input_schema: { type: 'object', properties: {} },
    run: ({ kit, token }) => kit.get('/v1/me/placements', { token }),
  },
  {
    name: 'list_my_classes',
    roles: TEACHER,
    description: 'List classes the teacher may act on today (as advisor or by delegation, with valid_until).',
    input_schema: { type: 'object', properties: {} },
    run: ({ kit, token }) => kit.get('/v1/teacher/classes', { token }),
  },
  {
    name: 'list_student_requests',
    roles: TEACHER,
    description: 'List leave/on-duty requests from students in the teacher’s authorised classes, optionally filtered by status (pending, approved, rejected, cancelled).',
    input_schema: { type: 'object', properties: { status: str('Status filter (optional)') } },
    run: ({ kit, token }, a) => kit.get('/v1/teacher/requests', { token, query: { status: a.status } }),
  },
  {
    name: 'get_class_attendance',
    roles: TEACHER,
    description: 'Get the student-wise attendance sheet for one of the teacher’s authorised classes (class_id from list_my_classes).',
    input_schema: { type: 'object', properties: { class_id: int('Class id') }, required: ['class_id'] },
    run: ({ kit, token }, a) => {
      need(Number.isInteger(a.class_id), 'class_id must be an integer');
      return kit.get(`/v1/teacher/classes/${a.class_id}/attendance`, { token });
    },
  },
  {
    name: 'approve_student_request',
    roles: TEACHER,
    write: true,
    description: 'Approve a pending student request by id, with an optional comment. Confirm the student, type and dates with the teacher first.',
    input_schema: {
      type: 'object',
      properties: { id: int('Request id'), comment: str('Optional comment'), user_confirmed: CONFIRMED },
      required: ['id', 'user_confirmed'],
    },
    run: ({ kit, token }, a) => {
      requireConfirmed(a);
      need(Number.isInteger(a.id), 'id must be an integer');
      return kit.post(`/v1/teacher/requests/${a.id}/approve`, { token, body: { comment: a.comment?.trim() || null } });
    },
  },
  {
    name: 'reject_student_request',
    roles: TEACHER,
    write: true,
    description: 'Reject a pending student request by id. A reason is mandatory. Confirm with the teacher first.',
    input_schema: {
      type: 'object',
      properties: { id: int('Request id'), reason: str('Reason for rejection'), user_confirmed: CONFIRMED },
      required: ['id', 'reason', 'user_confirmed'],
    },
    run: ({ kit, token }, a) => {
      requireConfirmed(a);
      need(Number.isInteger(a.id), 'id must be an integer');
      need(a.reason?.trim(), 'A rejection reason is required; ask the teacher for one.');
      return kit.post(`/v1/teacher/requests/${a.id}/reject`, { token, body: { reason: a.reason.trim() } });
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Which local table stores the college record a successful write returns (see database/db.js RECORD_TABLES). */
export const RECORD_TABLE_FOR = {
  submit_admission_application: 'admission_applications',
  submit_leave_or_od_request: 'requests',
  cancel_my_request: 'requests',
  approve_student_request: 'requests',
  reject_student_request: 'requests',
  register_for_placement_drive: 'placement_registrations',
};

export function toolsForRole(role) {
  return TOOLS.filter((t) => t.roles.includes(role));
}

const AFFIRMATIVE = /\b(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|go ahead|proceed|do it|please do|correct|haan|ha|ji)\b/i;
const NEGATIVE = /\b(no|nope|don't|dont|do not|not now|wait|stop|hold on)\b/i;

/** True when the user's latest utterance is a clear yes; the server enforces this rather than trusting the model's flag. */
export function isConfirmation(text = '') {
  return AFFIRMATIVE.test(text) && !NEGATIVE.test(text.replace(/\bno problem\b/gi, ''));
}

/** Runs a tool for the given context. Never throws: errors become a result the model can explain. */
export async function executeTool(name, rawArgs, ctx) {
  const tool = BY_NAME.get(name);
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  if (!tool || !tool.roles.includes(ctx.role)) {
    return { isError: true, content: JSON.stringify({ error: `Action ${name} is not available to this user.` }) };
  }
  if (tool.write && !isConfirmation(ctx.userText)) {
    return {
      isError: true,
      content: JSON.stringify({ error: 'Not done: the user has not said yes yet. Read the details back and ask "Shall I go ahead?". It can run after they say yes.' }),
    };
  }
  try {
    const data = await tool.run(ctx, args, tool.write ? idempotencyKey(ctx, name, args) : undefined);
    if (RECORD_TABLE_FOR[name] && ctx.onRecord) {
      // Saving locally must never turn a completed college action into a reported failure.
      await Promise.resolve(ctx.onRecord(RECORD_TABLE_FOR[name], data)).catch((err) => ctx.logger?.error?.(`[record ${name}] ${err.message}`));
    }
    let content = JSON.stringify(data ?? { ok: true });
    if (content.length > MAX_RESULT_CHARS) content = content.slice(0, MAX_RESULT_CHARS) + '…(truncated)';
    return { isError: false, content, write: Boolean(tool.write) };
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: JSON.stringify({ error: err.message }) };
    if (err instanceof KitApiError) {
      if (err.status === 401) ctx.onUnauthorized?.();
      return {
        isError: true,
        content: JSON.stringify({ error: { status: err.status, code: err.code, message: err.message, field: err.field } }),
      };
    }
    ctx.logger?.error?.(`[tool ${name}]`, err);
    return { isError: true, content: JSON.stringify({ error: 'Unexpected error while running this action.' }) };
  }
}
