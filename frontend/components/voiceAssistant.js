// Voice assistant card: header, conversation, suggestions, mic + typed input. Sends turns to the backend and speaks replies.
import { el } from '../services/api.js';
import { createMicButton } from './micButton.js';
import { createConversation } from './conversation.js';

function storageGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the conversation just won't survive a reload */
  }
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang?.startsWith('en')) ?? null;
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

const stopSpeaking = () => window.speechSynthesis?.cancel();

export function mountAssistant(root, { mode, title = 'KIT Assistant', greeting, suggestions = [] }) {
  const convKey = `kit_conv_${mode}`;
  let conversationId = storageGet(convKey);
  let busy = false;

  const log = createConversation();
  const status = el('span', { class: 'va-status' }, 'Tap the mic and speak');
  const setStatus = (text) => (status.textContent = text);
  const mic = createMicButton({ onStart: stopSpeaking, onAudio: (blob) => send(blob, blob.type, 'voice'), onStatus: setStatus });
  const input = el('input', { type: 'text', name: 'text', placeholder: 'Or type your question…', maxlength: '1000', 'aria-label': 'Type your question', autocomplete: 'off' });
  const form = el('form', { class: 'typed' }, input, el('button', { type: 'submit', class: 'btn' }, 'Send'));
  const reset = el('button', { type: 'button', class: 'link' }, 'New conversation');
  const tips = suggestions.length ? el('div', { class: 'tips' }, ...suggestions.map((s) => el('button', { type: 'button', class: 'chip' }, s))) : null;

  const head = el('div', { class: 'va-head' }, el('div', { class: 'va-title' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('div', {}, el('strong', {}, title), status)), reset);
  root.replaceChildren(el('div', { class: 'card va' }, head, log.element, ...(tips ? [tips] : []), el('div', { class: 'va-bar' }, mic.element, form)));
  if (greeting) log.add('assistant', greeting);

  function setBusy(value, message) {
    busy = value;
    mic.setBusy(value);
    form.querySelector('button').disabled = value;
    if (message) setStatus(message);
  }

  async function handleResponse(res, kind) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (data.conversationId) {
      conversationId = data.conversationId;
      storageSet(convKey, conversationId);
    }
    if (kind === 'voice' && data.transcript) log.add('user', data.transcript);
    const reply = data.reply ?? data.error ?? 'Something went wrong. Please try again.';
    const done = (data.actions ?? []).filter((a) => a.write && a.ok).map((a) => a.name.replaceAll('_', ' '));
    log.add('assistant', reply, done.length ? `✓ ${done.join(', ')}` : undefined);
    speak(reply);
    if (data.sessionExpired) {
      log.add('assistant', 'Your session has expired. Please log in again.');
      setTimeout(() => (window.location.href = '/login'), 2500);
    }
    setBusy(false, res.ok ? 'Tap the mic to reply' : 'Something went wrong — try again');
  }

  async function send(body, contentType, kind) {
    setBusy(true, kind === 'voice' ? 'Transcribing and thinking…' : 'Thinking…');
    const params = new URLSearchParams({ mode });
    if (conversationId) params.set('conversationId', conversationId);
    try {
      const res = await fetch(`/api/assistant/${kind}?${params}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
      await handleResponse(res, kind);
    } catch {
      log.add('assistant', 'I could not reach the server. Check your connection and try again.');
      setBusy(false, 'Connection problem');
    }
  }

  const sendText = (text) => {
    log.add('user', text);
    send(JSON.stringify({ text }), 'application/json', 'text');
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    stopSpeaking();
    input.value = '';
    sendText(text);
  });

  tips?.addEventListener('click', (e) => {
    if (e.target.classList.contains('chip') && !busy) sendText(e.target.textContent);
  });

  reset.addEventListener('click', () => {
    stopSpeaking();
    conversationId = null;
    storageSet(convKey, null);
    log.clear();
    if (greeting) log.add('assistant', greeting);
    setStatus('New conversation started');
  });
}
