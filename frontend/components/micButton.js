// Round mic button: records with MediaRecorder and stops automatically when the speaker goes quiet.

const SILENCE_MS = 1300;
const NO_SPEECH_MS = 8000;
const MAX_RECORD_MS = 30000;
const SPEECH_RMS = 0.025;
const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const MIC = ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3'];
const STOP = ['M7 7h10v10H7z'];

function pickMimeType() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return options.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';
}

/** onStart(): recording begins. onAudio(blob): recording finished. onStatus(text): status message. */
export function createMicButton({ onStart, onAudio, onStatus }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'talk';
  let recorder = null;
  let stream = null;
  let audioCtx = null;
  let stopTimer = null;
  let busy = false;

  const recording = () => recorder?.state === 'recording';

  function render() {
    const rec = recording();
    button.replaceChildren(icon(rec ? STOP : MIC));
    button.setAttribute('aria-label', rec ? 'Stop recording' : 'Tap to talk');
    button.title = rec ? 'Stop' : 'Tap to talk';
    button.disabled = busy && !rec;
    button.classList.toggle('recording', rec);
    button.classList.toggle('busy', busy && !rec);
  }

  function cleanup() {
    clearTimeout(stopTimer);
    stream?.getTracks().forEach((t) => t.stop());
    audioCtx?.close().catch(() => {});
    stream = null;
    audioCtx = null;
  }

  function stop(discard) {
    if (recording()) {
      recorder.discard = discard;
      recorder.stop();
    }
  }

  function watchSilence() {
    audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let heard = false;
    let lastVoice = started;
    const tick = () => {
      if (!recording()) return;
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
      const now = performance.now();
      if (rms > SPEECH_RMS) {
        heard = true;
        lastVoice = now;
      }
      if ((heard && now - lastVoice > SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS)) return stop(!heard);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function start() {
    onStart?.();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onStatus('This browser cannot record audio. Please type instead.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      onStatus('Microphone permission was denied. You can type instead.');
      return;
    }
    const mimeType = pickMimeType();
    const chunks = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const discard = recorder.discard;
      cleanup();
      render();
      if (discard) return onStatus("I didn't hear anything. Tap the mic to try again.");
      onAudio(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    };
    recorder.start();
    render();
    onStatus('Listening… pause when you are done.');
    stopTimer = setTimeout(() => stop(false), MAX_RECORD_MS);
    watchSilence();
  }

  button.addEventListener('click', () => {
    if (recording()) stop(false);
    else if (!busy) start();
  });
  render();

  return {
    element: button,
    setBusy(value) {
      busy = value;
      render();
    },
  };
}
