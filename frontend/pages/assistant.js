import { api, el, currentUser, firstName, initials, formatDate } from '../services/api.js';
import { mountShell } from '../services/layout.js';
import { mountAssistant } from '../components/voiceAssistant.js';
import { icon } from '../components/icons.js';

const user = await currentUser();
if (!user) {
  location.href = '/login';
  throw new Error('redirecting');
}
const isTeacher = user.role === 'teacher';
const overview = await api('/api/overview').catch(() => null);
const content = mountShell(user, { active: 'home', badge: overview?.pendingCount ?? 0 });

const QUICK = isTeacher
  ? [
      ['inbox', 'Pending requests', 'Do I have any pending requests?'],
      ['users', 'My classes', 'Which classes can I act on?'],
      ['chart', 'Class attendance', 'Who in my class is below 75% attendance?'],
      ['book', 'Leave rules', 'What are the rules for approving on-duty?'],
    ]
  : [
      ['chart', 'Check attendance', 'What is my attendance?'],
      ['leave', 'Request leave', 'I want to apply for leave'],
      ['flag', 'Apply on-duty', 'I want to apply for on-duty'],
      ['briefcase', 'Placement drives', 'Which placement drives can I join?'],
      ['clock', 'View timetable', "What is today's timetable?"],
      ['book', 'Ask a subject doubt', 'Explain normalization in DBMS simply'],
    ];

const assistantRoot = el('div');
const quick = el('div', { class: 'card pad quick' }, el('h2', {}, 'Quick actions'));
const side = el('div', { class: 'side-col' }, quick);
content.append(
  el('div', { class: 'greeting' }, el('h1', {}, `Hello ${firstName(user.full_name)}!`), el('p', { class: 'muted' }, 'How can I help you today?')),
  el('div', { class: 'home-grid' }, assistantRoot, side),
);

const assistant = mountAssistant(assistantRoot, {
  mode: 'member',
  userInitials: initials(user.full_name),
  greeting: isTeacher
    ? `Hello ${firstName(user.full_name)}! I can review and decide leave and on-duty requests, and check class attendance.`
    : `Hi ${firstName(user.full_name)}! Ask me about attendance, timetable, leave or on-duty, placements, rules or a subject doubt.`,
});

for (const [iconName, label, prompt] of QUICK) {
  const b = el('button', { type: 'button', class: 'quick-btn' }, el('span', { class: 'quick-icon' }, icon(iconName, 18)), el('span', {}, label));
  b.addEventListener('click', () => assistant.ask(prompt));
  quick.append(b);
}

if (!isTeacher) {
  const exam = overview?.nextExam;
  side.append(
    el(
      'div',
      { class: 'card pad info-card' },
      el('span', { class: 'info-icon' }, icon('calendar', 22)),
      el('div', {}, el('small', { class: 'muted' }, 'Next exam'), el('strong', {}, exam ? exam.title : 'No exams scheduled'), exam ? el('span', { class: 'muted' }, formatDate(exam.date)) : null),
    ),
  );
  if (typeof overview?.attendance === 'number') {
    const pct = overview.attendance;
    side.append(
      el(
        'div',
        { class: `card pad info-card ${pct < 75 ? 'warn' : ''}` },
        el('span', { class: 'info-icon' }, icon('chart', 22)),
        el('div', {}, el('small', { class: 'muted' }, 'Overall attendance'), el('strong', {}, `${pct}%`), el('span', { class: 'muted' }, pct < 75 ? 'Below the 75% minimum' : 'Minimum is 75% per course')),
      ),
    );
  }
} else {
  content.append(await approvalsPanel());
}

// Sidebar shortcuts land here with ?ask=…; send it once, then clean the URL.
const asked = new URLSearchParams(location.search).get('ask');
if (asked) {
  history.replaceState(null, '', '/assistant');
  assistant.ask(asked.slice(0, 300));
}

async function approvalsPanel() {
  const list = el('div', { class: 'approvals' }, el('p', { class: 'muted' }, 'Loading…'));
  const panel = el('section', { class: 'card pad', id: 'approvals' }, el('div', { class: 'card-head' }, el('h2', {}, 'Pending approvals'), el('span', { class: 'muted' }, 'Your authorised classes')), list);
  const TYPE = { on_duty: ['On-duty request', 'flag'], personal_leave: ['Leave request', 'leave'], medical_leave: ['Medical leave', 'leave'] };

  function row(r) {
    const [label, iconName] = TYPE[r.type] ?? [r.type, 'inbox'];
    const dates = r.from_date === r.to_date ? formatDate(r.from_date) : `${formatDate(r.from_date)} – ${formatDate(r.to_date)}`;
    const actions = el('div', { class: 'row-actions' });
    const approve = el('button', { type: 'button', class: 'btn btn-sm' }, 'Approve');
    const reject = el('button', { type: 'button', class: 'btn btn-sm btn-outline' }, 'Reject');
    actions.append(approve, reject);
    const item = el(
      'article',
      { class: 'approval' },
      el('span', { class: `approval-icon t-${r.type}` }, icon(iconName, 20)),
      el('div', { class: 'approval-body' }, el('strong', {}, `${label} · #${r.id}`), el('span', {}, `From ${r.student_name}${r.class_code ? ` (${r.class_code})` : ''}`), el('span', { class: 'muted' }, `${dates}${r.half_day ? ' · half day' : ''} — ${r.event_name ?? r.reason}`)),
      actions,
    );

    async function decide(decision, reason) {
      actions.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try {
        await api(`/api/teacher/requests/${r.id}/${decision}`, { method: 'POST', body: JSON.stringify(decision === 'reject' ? { reason } : {}) });
        actions.replaceChildren(el('span', { class: `status ${decision === 'approve' ? 'ok' : 'no'}` }, decision === 'approve' ? '✓ Approved' : '✕ Rejected'));
        item.classList.add('decided');
        const badge = document.querySelector('.side-link .count');
        if (badge) badge.textContent = String(Math.max(0, Number(badge.textContent) - 1));
      } catch (err) {
        actions.append(el('span', { class: 'error' }, err.message));
        actions.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }
    }

    approve.addEventListener('click', () => decide('approve'));
    reject.addEventListener('click', () => {
      const reason = el('input', { placeholder: 'Reason for rejecting', maxlength: '300', 'aria-label': 'Reason for rejecting' });
      const confirm = el('button', { type: 'button', class: 'btn btn-sm btn-danger' }, 'Confirm reject');
      const cancel = el('button', { type: 'button', class: 'btn btn-sm btn-outline' }, 'Cancel');
      actions.replaceChildren(reason, confirm, cancel);
      reason.focus();
      confirm.addEventListener('click', () => (reason.value.trim() ? decide('reject', reason.value.trim()) : reason.focus()));
      cancel.addEventListener('click', () => actions.replaceChildren(approve, reject));
    });
    return item;
  }

  try {
    const { requests } = await api('/api/teacher/requests?status=pending');
    list.replaceChildren(...(requests.length ? requests.map(row) : [el('p', { class: 'empty' }, 'No pending requests. All caught up!')]));
  } catch (err) {
    list.replaceChildren(el('p', { class: 'error' }, `Could not load requests: ${err.message}`));
  }
  return panel;
}
