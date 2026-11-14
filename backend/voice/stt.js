// Speech-to-text through hosted speech services with failover (the browser Web Speech API is not used).

const VOCAB_HINT =
  'Knotopian Institute of Technology, KIT, B.Tech, M.Tech, CSE, ECE, MECH, on-duty, OD, CGPA, arrears, internal assessment, Zoho, TCS, Freshworks, DBMS, normalization, Coimbatore, admission, admissions, application, eligibility, fees, approve, reject.';

const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

export class SttUnavailableError extends Error {}

function whisperLike({ name, url, apiKey, model, timeoutMs, fetchImpl }) {
  return {
    name,
    async transcribe(audio, mimeType) {
      const type = mimeType.split(';')[0];
      const form = new FormData();
      form.append('file', new Blob([audio], { type }), `speech.${EXT[type] ?? 'webm'}`);
      form.append('model', model);
      form.append('prompt', VOCAB_HINT);
      form.append('response_format', 'json');
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`${name} STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return (data.text ?? '').trim();
    },
  };
}

function deepgram({ apiKey, timeoutMs, fetchImpl }) {
  return {
    name: 'deepgram',
    async transcribe(audio, mimeType) {
      const res = await fetchImpl('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&detect_language=true', {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': mimeType.split(';')[0] },
        body: audio,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`deepgram STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
    },
  };
}

export function buildSttProviders({ groqKey, openaiKey, deepgramKey, timeoutMs = 15000 }, fetchImpl = fetch) {
  const list = [];
  if (groqKey) {
    const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    list.push(whisperLike({ name: 'groq', url, apiKey: groqKey, model: 'whisper-large-v3-turbo', timeoutMs, fetchImpl }));
    // Same key, separate per-model rate limit: a backup when the turbo model is throttled.
    list.push(whisperLike({ name: 'groq-large', url, apiKey: groqKey, model: 'whisper-large-v3', timeoutMs, fetchImpl }));
  }
  if (deepgramKey) list.push(deepgram({ apiKey: deepgramKey, timeoutMs, fetchImpl }));
  if (openaiKey) {
    list.push(whisperLike({ name: 'openai', url: 'https://api.openai.com/v1/audio/transcriptions', apiKey: openaiKey, model: 'gpt-4o-mini-transcribe', timeoutMs, fetchImpl }));
  }
  return list;
}

export function createTranscriber(providers, logger = console) {
  return {
    available: () => providers.length > 0,
    async transcribe(audio, mimeType) {
      for (const p of providers) {
        const started = Date.now();
        try {
          const text = await p.transcribe(audio, mimeType);
          logger.info?.(`[stt] ${p.name} transcribed in ${Date.now() - started}ms`);
          return { text, provider: p.name };
        } catch (err) {
          logger.error?.(`[stt] ${p.name} failed: ${err.message}`);
        }
      }
      throw new SttUnavailableError('No speech service could transcribe the audio');
    },
  };
}
