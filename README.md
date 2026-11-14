# KIT Voice Assistant

Real-time voice assistant for Knotopian Institute of Technology. People speak and it replies aloud. It answers from live college data and documents, and completes requests in the KIT college system.

**Live:** _add Render URL_

## Features
| Page | Who | Can do |
|---|---|---|
| `/` | Public | Course table; "Talk to us" answers admission questions and **submits applications**. No student data. |
| `/assistant` | Student | Attendance, timetable, calendar, CGPA; **leave / on-duty** (submit, cancel); **placement registration**; rules; lesson doubts |
| | Teacher | Pending requests → **approve / reject**; class attendance |
| `/history` | All | Own past conversations only |

- **Voice:** mic → server speech-to-text (Groq Whisper; the browser's speech recognition is never used) → AI with tools → reply. Recording stops on silence; typing also works.
- **Voice replies are the user's choice:** *when I speak* (default: spoken questions get spoken answers, typed questions get text), *always*, or *off*; every reply also has a 🔊 button.
- **Correct answers:** live API data plus the documents in force; circulars override the handbook; superseded and draft documents are ignored.
- **Safe actions:** writes run only after the user says "yes" (enforced by the server) and are sent with an idempotency key.
- **Stored data** (Postgres; SQLite locally): `conversations`, `messages`, plus records the assistant creates or changes, using the college API schemas as columns: `users` (UserSummary, on login), `admission_applications`, `requests` (leave/on-duty, updated on cancel/approve/reject), `placement_registrations`. Each record is linked to its conversation. College data itself (courses, attendance, calendar) is always read live, never copied.
- **Failover:** AI: Claude → Groq gpt-oss-120b → qwen3.8-27b → gpt-oss-20b → Gemini/OpenAI (whichever keys are set). Speech-to-text: Groq → Deepgram → OpenAI.

## Run
```bash
npm install
cp .env.example .env   # fill keys
npm start              # http://localhost:3000
npm test               # 47 tests
docker compose up --build   # app + Postgres
```
Required: `KIT_PARTICIPANT_KEY`, `GROQ_API_KEY`. Optional: `ANTHROPIC_API_KEY` (Claude becomes the main AI), `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL` (default: SQLite).

Test logins (password `Kit@2026`): students `arjun priya kavya rahul karthik meena divya sneha`; teachers `lakshmi senthil`.

## Deploy (Render)
New → Blueprint → this repo (`render.yaml` creates the app + Postgres). Set the secret env vars. Free instances sleep after 15 minutes idle, so open the app before judging.

## Layout
```
frontend/  pages/        index · login · assistant · history (.html + page script)
           components/   voiceAssistant · micButton · conversation · icons (generated from lucide)
           services/     api (fetch + DOM helpers) · layout (header, sidebar, footer) · speech (spoken replies, reply setting) · theme
           styles/       style.css imports, in order: tokens · base · public · assistant · portal · responsive · footer · landing · brand · portal-home · refinements
           images/       robot · campus · logo-mark
scripts/build-icons.mjs  generates components/icons.js from lucide (npm run icons)
backend/   main.js  app.js (routes)  config.js
           auth/security.js         sessions, cookies
           agent/                   orchestrator, prompts, tools, llm/{claude, openaiCompat}
           voice/stt.js             speech-to-text failover
           routes/portal.js         overview card + teacher approve/reject buttons
           services/                collegeApi, history
           knowledge/               pdfLoader, rag (live docs, edition selection, excerpts)
           database/db.js           Postgres | SQLite
           tests/
```
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/COLLEGE-API.md](docs/COLLEGE-API.md). Not built, per the brief: the college system, dashboards, charts, uploads.
