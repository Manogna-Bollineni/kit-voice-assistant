# Architecture

## Turn flow
1. `micButton.js` records (MediaRecorder) and stops after 1.3 s of silence (or 8 s with no speech, or 30 s maximum). Tapping it interrupts speech output.
2. POST `/api/assistant/voice?mode=public|member` → `voice/stt.js` transcribes (with a vocabulary hint for college terms).
3. `app.js` resolves the identity (session, or a visitor cookie), loads the conversation (owner only) and the last 12 messages.
4. `agent/orchestrator.js` builds the per-role tools and the context (college date from `/v1/today`, user, earlier action results), then tries the providers in order:
   - `llm/claude.js`: `claude-opus-5-5`, effort `low`, full documents in a cached system block, server-side refusal fallback.
   - `llm/openaiCompat.js` (Groq/Gemini/OpenAI): retrieved excerpts (`rag.retrieve`), one-line tool descriptions, waits up to 8 s on a 429, otherwise moves to the next model. Each Groq model has its own 8k tokens/min limit.
5. `agent/tools.js` checks the role, validates input, and **runs a write only if the user's latest message is a yes** (`isConfirmation`), sending an idempotency key. College API errors go back to the model to explain.
6. The reply (internal notes stripped) is saved and spoken with browser `speechSynthesis`.

## Accuracy
| Trap | Handling |
|---|---|
| 2025 + 2026 handbooks | Keep the newest edition effective on or before the college date |
| Circular 12/2026 (on-duty proof: 3 days for B.Tech) | Circulars always included and listed first; precedence rule in the prompt |
| Annexure E draft | The prompt says drafts and "not adopted" items have no effect |
| B.Tech vs M.Tech rules | The user's programme is in the context |
| Sandbox date ≠ real date | The college date goes into every turn |
| Leave on an internal-assessment day; attendance drop | The prompt requires checking the calendar and the attendance effect before submitting |
| Surprise documents | Re-listed every 2 minutes; a failed refresh keeps the last good set |
| Excerpt quality | Line-based chunks at rule headings; full text when small (brochure) |

## Security
- The college JWT stays on the server; the browser gets an httpOnly SameSite cookie.
- Tool access is gated by role on the server. Public mode has no token.
- History queries are filtered by owner.
- Helmet CSP (self only), microphone limited to this site, `textContent` rendering, body limits, and rate limits (30 turns and 10 logins per minute per IP).
- Documents and tool results are treated as data, not instructions.

## Measured (Groq, live sandbox)
Voice turn, speech-to-text plus answer: about 1.1 s. Turns with tools: 1–4 s, longer when a rate limit forces a wait.
