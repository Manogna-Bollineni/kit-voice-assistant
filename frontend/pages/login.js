import { api, el, currentUser } from '../services/api.js';
import { mountPublic } from '../services/layout.js';
import { icon } from '../components/icons.js';

const user = await currentUser();
if (user) location.href = '/assistant';
const main = mountPublic(null, 'login');

let role = 'student';
const idLabel = el('span', { class: 'sr-only' }, 'Student ID');
const idInput = el('input', { name: 'login_id', autocomplete: 'username', required: '', maxlength: '64', placeholder: 'Student ID' });
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
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login_id: idInput.value.trim(), password: pwInput.value }) });
    location.href = '/assistant';
  } catch (err) {
    error.textContent = err.message;
    submit.disabled = false;
    submit.textContent = 'Login';
  }
});

main.classList.add('login-page');
main.append(
  el(
    'div',
    { class: 'login-layout' },
    el('div', { class: 'login-art', 'aria-hidden': 'true' }, el('img', { src: '/images/campus.svg', alt: '' })),
    el(
      'div',
      { class: 'card login-card' },
      el('div', { class: 'login-brand' }, el('span', { class: 'logo logo-lg' }, 'KIT'), el('strong', {}, 'Knotopian Institute of Technology')),
      el('h1', {}, 'Login to continue'),
      el('p', { class: 'muted' }, 'Access your personalised assistant and college services.'),
      form,
      el('div', { class: 'divider' }, el('span', {}, 'or')),
      el('p', { class: 'center muted' }, 'New to KIT? ', el('a', { href: '/#talk' }, 'Apply for admission')),
    ),
  ),
);
