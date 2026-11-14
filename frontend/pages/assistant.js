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
const exam = overview?.nextExam ?? null; // used for the bell notification only
const askUrl = (text) => `/assistant?ask=${encodeURIComponent(text)}`;
const EXAM_PROMPT = 'When is my next exam, and what should I know about it?';

const notices = [];
if (isTeacher && overview?.pendingCount) {
  notices.push({ icon: 'users', title: `${overview.pendingCount} pending request${overview.pendingCount > 1 ? 's' : ''}`, detail: 'Waiting for your decision', href: '#approvals' });
}
if (!isTeacher && exam) notices.push({ icon: 'calendar', title: 'Next exam', detail: `${exam.title} · ${formatDate(exam.date)}`, href: askUrl(EXAM_PROMPT) });

const content = mountShell(user, { active: 'home', notices });
// Fit-to-window layout only when there is room for it; smaller screens scroll normally so nothing gets clipped.
const roomy = matchMedia('(min-width: 1001px) and (min-height: 700px)');
const applyFit = () => document.body.classList.toggle('portal-fit', roomy.matches);
roomy.addEventListener('change', applyFit);
applyFit();

const QUICK = isTeacher
  ? [
      ['users', 'Pending requests', 'Do I have any pending requests?'],
      ['book', 'My classes', 'Which classes can I act on?'],
      ['flag', 'On-duty rules', 'What are the rules for approving on-duty?'],
    ]
  : [
      ['calendar', 'View timetable', "What is today's timetable?"],
      ['clock', 'Next exam', EXAM_PROMPT],
      ['briefcase', 'Apply for placement', 'Which placement drives can I join?'],
      ['book', 'Ask subject doubt', 'Explain normalization in DBMS simply'],
      ['history', 'My requests', 'Show my leave and on-duty requests'],
    ];

// The services the brief lists for logged-in users, scoped to this person only.
const SERVICES = isTeacher
  ? [
      ['users', 'Approvals', 'Leave & on-duty decisions', 'Do I have any pending requests?'],
      ['chart', 'Class attendance', 'Your authorised classes', 'Who in my class is below 75% attendance?'],
      ['book', 'College rules', 'Handbook & circulars', 'What are the rules for approving leave?'],
      ['flag', 'Delegations', 'Classes you can act on', 'Which classes can I approve requests for today?'],
    ]
  : [
      ['chart', 'Attendance', 'Per subject, as of today', 'What is my attendance in each subject?'],
      ['book', 'College rules', 'Handbook & circulars', 'What are the attendance and leave rules for me?'],
      ['leave', 'Leave request', 'Personal, medical, half-day', 'I want to apply for leave'],
      ['flag', 'On-duty request', 'Events & competitions', 'I want to apply for on-duty'],
    ];

const assistantRoot = el('div', { class: 'hero-col' });
const quick = el('div', { class: 'card pad quick' }, el('h2', {}, 'Quick actions'));
const side = el('div', { class: `side-col ${isTeacher ? 'teacher' : ''}` }, quick);
content.append(
  el('div', { class: 'greeting' }, el('h1', {}, `Hello ${firstName(user.full_name)}!`), el('p', { class: 'muted' }, 'How can I help you today?')),
  el('div', { class: `home-grid ${isTeacher ? 'teacher' : ''}` }, assistantRoot, side),
);

const assistant = mountAssistant(assistantRoot, {
  mode: 'member',
  layout: 'hero',
  userInitials: initials(user.full_name),
  suggestions: isTeacher ? ['Any pending requests?', 'Show my classes'] : ['What is my attendance?', 'Can I take leave tomorrow?', 'When is my next exam?'],
});

for (const [iconName, label, prompt] of QUICK) {
  const b = el('button', { type: 'button', class: 'quick-btn' }, el('span', { class: 'quick-icon' }, icon(iconName, 18)), el('span', {}, label));
  b.addEventListener('click', () => assistant.ask(prompt));
  quick.append(b);
}

const tiles = el('div', { class: 'service-tiles' });
for (const [iconName, label, sub, prompt] of SERVICES) {
  const t = el('button', { type: 'button', class: 'service' }, el('span', { class: 'service-icon' }, icon(iconName, 20)), el('span', {}, el('strong', {}, label), el('small', {}, sub)));
  t.addEventListener('click', () => assistant.ask(prompt));
  tiles.append(t);
}
content.append(
  el(
    'section',
    { class: 'card services' },
    el('div', { class: 'services-head' }, el('strong', {}, isTeacher ? 'Teacher services' : 'Student services')),
    tiles,
  ),
);
if (isTeacher) side.append(await approvalsPanel());
else side.append(await recentPanel());

/** History panel: latest conversations, filling the space under Quick actions. */
async function recentPanel() {
  const list = el('div', { class: 'recent-list' }, el('p', { class: 'muted' }, 'Loading…'));
  const panel = el('section', { class: 'card pad recent' }, el('div', { class: 'card-head' }, el('h2', {}, 'History'), el('a', { class: 'link', href: '/history' }, 'View all')), list);
  try {
    const { conversations } = await api('/api/history');
    const items = conversations.filter((c) => c.mode === 'member').slice(0, 6);
    list.replaceChildren(
      ...(items.length
        ? items.map((c) => el('a', { class: 'recent-item', href: `/history#${encodeURIComponent(c.id)}` }, el('span', { class: 'row-icon' }, icon('mic', 16)), el('span', { class: 'recent-text' }, el('strong', {}, c.title), el('small', {}, formatDate(c.updatedAt, true)))))
        : [el('p', { class: 'empty' }, 'Your past conversations will appear here.')]),
    );
  } catch {
    list.replaceChildren(el('p', { class: 'muted' }, 'History is unavailable right now.'));
  }
  return panel;
}

// Notifications and links land here with ?ask=…; send it once, then clean the URL.
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
    const [label, iconName] = TYPE[r.type] ?? [r.type, 'users'];
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
