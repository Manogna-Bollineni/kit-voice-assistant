import { api, el, currentUser } from '../services/api.js';
import { mountPublic, TAGLINE } from '../services/layout.js';
import { icon } from '../components/icons.js';
import { clearOpenConversation } from '../components/voiceAssistant.js';

const user = await currentUser();
const nextPath = new URLSearchParams(location.search).get('next') ?? '/assistant';
if (user) location.replace(nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/assistant');
const main = mountPublic(null, 'login');

let role = 'student';
const idLabel = el('span', { class: 'sr-only' }, 'Student ID');
const idInput = el('input', { name: 'login_id', autocomplete: 'username', required: '', minlength: '2', maxlength: '64', pattern: '[A-Za-z0-9._-]{2,64}', title: 'Letters, numbers, dots, dashes or underscores', placeholder: 'Student ID', autocapitalize: 'none', spellcheck: 'false' });
const pwInput = el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: '', maxlength: '128', placeholder: 'Password' });
const eye = el('button', { type: 'button', class: 'field-btn', 'aria-label': 'Show password' }, icon('eye', 18));
eye.addEventListener('click', () => {
  const show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

const tabs = el('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Account type' });
for (const [value, label] of [['student', 'Student'], ['teacher', 'Teacher']]) {
  const tab = el('button', { type: 'button', role: 'tab', 'aria-selected': String(value === role) }, label);
  tab.addEventListener('click', () => {
    role = value;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
    idInput.placeholder = idLabel.textContent = value === 'student' ? 'Student ID' : 'Staff ID';
  });
  tabs.append(tab);
}

const submit = el('button', { class: 'btn btn-block', type: 'submit' }, 'Login');
const error = el('p', { class: 'error', role: 'alert' });
const form = el(
  'form',
  { class: 'login-form' },
  tabs,
  el('label', { class: 'field' }, idLabel, icon('id', 18), idInput),
  el('label', { class: 'field' }, el('span', { class: 'sr-only' }, 'Password'), icon('lock', 18), pwInput, eye),
  submit,
  error,
);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Logging in…';
  try {
    const loginId = idInput.value.trim();
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(loginId)) throw new Error('Enter a valid login ID (letters, numbers, dots, dashes or underscores).');
    if (!pwInput.value) throw new Error('Enter your password.');
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login_id: loginId, password: pwInput.value, next: nextPath }) });
    clearOpenConversation();
    location.replace(data.next ?? '/assistant');
  } catch (err) {
    error.textContent = err.message;
    submit.disabled = false;
    submit.textContent = 'Login';
  }
});

/** "New user?" and "Forgot password?": accounts are managed by the college office, so both show who to contact. */
function helpLinks() {
  const HELP = {
    new: ['New user?', 'Login accounts are created by the college. Students get their login ID and first password from the department office; teachers from the IT office.'],
    forgot: ['Forgot password?', 'Passwords are reset by the college office. Contact them with your login ID and they will set a new one for you.'],
  };
  const note = el('div', { class: 'login-help', hidden: '', role: 'status' });
  let contact = null;
  const show = async (key) => {
    const [title, text] = HELP[key];
    note.hidden = false;
    note.replaceChildren(el('strong', {}, title), el('p', {}, text), el('p', { class: 'muted' }, 'Loading contact details…'));
    contact ??= await api('/api/public/home').then((d) => d.college?.contact ?? null).catch(() => null);
    note.lastChild.replaceWith(
      contact
        ? el('p', { class: 'login-help-contact' }, icon('phone', 16), el('a', { href: `tel:${contact.phone.replace(/\s+/g, '')}` }, contact.phone), icon('mail', 16), el('a', { href: `mailto:${contact.email}` }, contact.email))
        : el('p', { class: 'muted' }, 'Please contact the college office during office hours (Monday to Saturday, 9:00 AM – 5:00 PM).'),
    );
  };
  const link = (key) => {
    const b = el('button', { type: 'button', class: 'link-btn' }, HELP[key][0]);
    b.addEventListener('click', () => show(key));
    return b;
  };
  return el('div', { class: 'login-help-wrap' }, el('div', { class: 'login-links' }, link('new'), link('forgot')), note);
}

main.classList.add('login-page');
main.append(
  el(
    'div',
    { class: 'login-layout' },
    el('div', { class: 'login-art', 'aria-hidden': 'true' }, el('img', { src: '/images/campus.svg', alt: '' })),
    el(
      'div',
      { class: 'card login-card' },
      el('div', { class: 'login-brand' }, el('div', { class: 'brand-lockup' }, el('img', { class: 'mark', src: '/images/logo-mark.svg', alt: '' }), el('span', { class: 'wordmark' }, 'KIT')), el('strong', {}, 'Knotopian Institute of Technology'), el('span', { class: 'muted' }, TAGLINE)),
      el('h1', {}, 'Login to continue'),
      el('p', { class: 'muted' }, 'Access your personalised assistant and college services.'),
      form,
      helpLinks(),
    ),
  ),
);
