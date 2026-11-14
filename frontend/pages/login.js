import { api, renderNav } from '../services/api.js';

renderNav().then((user) => {
  if (user) window.location.href = '/assistant';
});

const form = document.getElementById('login');
const error = document.getElementById('error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Logging in…';
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    window.location.href = '/assistant';
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
    button.textContent = 'Log in';
  }
});
