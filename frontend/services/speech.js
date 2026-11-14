// Spoken replies (text-to-speech) and the user's voice-reply preference. Speech-to-text is server-side, never here.

const MODE_KEY = 'kit_reply_voice';
export const REPLY_MODES = {
  auto: 'Voice replies: when I speak',
  on: 'Voice replies: always',
  off: 'Voice replies: off',
};

export function getReplyMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return saved in REPLY_MODES ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function setReplyMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

/** Whether a reply should be read aloud, given how the question was asked ('voice' | 'text'). */
export function shouldSpeak(mode, askedBy) {
  return mode === 'on' || (mode === 'auto' && askedBy === 'voice');
}

/** Speaks text; onStart/onEnd let the UI animate while speaking. */
export function speak(text, { onStart, onEnd } = {}) {
  if (!('speechSynthesis' in window) || !text) return onEnd?.();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang?.startsWith('en')) ?? null;
  u.rate = 1.05;
  u.onstart = () => onStart?.();
  u.onend = u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}
