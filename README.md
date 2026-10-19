# Scene Partner

An AI reader for actors' self-tapes. Paste in your audition side, pick your role, and an AI
voice reads the other characters' lines while you perform and record.

## The problem

I'm an actor. Most auditions today are self-tapes: you record your scene at home and send it to
casting. But a scene has other characters, and someone has to read their lines off camera so you
have something to react to. When the deadline is tonight and nobody is free, you end up
performing to silence, and the tape suffers.

Actor friends and castmates have complained about this for years. Scene Partner is the reader
who's always available.

## What works today

- **Script parsing.** Paste a side, or upload a PDF (up to 3 MB). Gemini turns it into clean,
  editable lines: who speaks, what they say, parentheticals like *(quieter)*, and stage
  directions. Page numbers, "CONTINUED" and headers are dropped, and dialogue is never reworded
  (the server checks every line against what you pasted).
- **AI costar voices.** Choose a voice for each other character (ElevenLabs Eleven v4).
  Parentheticals become delivery cues, and stage directions are never read aloud. "Prepare
  scene" shows the cost before generating, and each line is generated only once.
- **Hands-free rehearsal.** The costar reads their line, then the app listens to your mic and
  moves on when you finish your line. It ignores breaths, short pauses and background noise
  that starts mid-scene. Space (or a presentation clicker) always ends your line instantly.
  A live mic meter shows what it hears.
- **Pacing controls.** Costar speed (0.75–1.25×, pitch preserved), the pause before the costar
  picks up their cue, and how long a silence ends your line.
- **Recording.** Camera and mic at 720p, with a mirrored preview but an unmirrored recording
  (standard self-tape practice). The mic records with all processing off, so your real vocal
  dynamics come through, and it picks the reader up from the speakers like a real off-camera
  reader. Play the take back, download it as MP4 (e.g. `study-room_PRIYA_take2_2026-10-16.mp4`),
  or retake instantly.
- **Demo mode.** A guest passcode opens a pre-loaded scene with pre-generated voices, so anyone
  can try the full flow without using API credits.

## Try it

A live demo is deployed on Vercel. It's behind a passcode, so ask me for guest access. The demo
scene is a short original two-hander, "Study Room". Pick PRIYA or MARCUS, press **Start**, allow
the camera and mic, and read your lines out loud.

## Tech stack

- **Next.js 16** (App Router) with **TypeScript** and **Tailwind CSS**, deployed on **Vercel**
- **Gemini** (`gemini-3.5-flash-lite`, via `@google/genai`) for script parsing, with structured
  JSON output validated by **zod**
- **ElevenLabs** (`eleven_v4`) for costar voices
- Browser APIs: **Web Audio** (mic level for turn-taking), **MediaRecorder** (recording),
  **IndexedDB** (audio cache), **localStorage** (settings)
- **Vitest** for tests

## How it works

```
Browser                                   Server (Next.js on Vercel)
───────                                   ──────────────────────────
Paste text / PDF  ── POST /api/parse ──▶  Gemini → JSON → zod check → lines
Prepare scene     ── POST /api/tts ────▶  ElevenLabs → MP3   (one request per line)
  └─ saves each clip in IndexedDB, keyed by a hash of voice + model + text
Rehearse + record (all in the browser: mic, camera, turn-taking, recording)
```

- **Passcode gate** ([proxy.ts](proxy.ts), [lib/auth.ts](lib/auth.ts)). Every page and API route
  requires a login. The login cookie is `httpOnly` and holds a signature derived from the
  passcode, never the passcode itself. If the passcode isn't configured, everyone is locked out.
  The guest passcode gives a "guest" login that the API routes refuse, so demo users can't spend
  credits.
- **Parse route** ([app/api/parse/route.ts](app/api/parse/route.ts)). Checks the input (text up
  to 20,000 characters, or a real PDF up to 3 MB), sends it to Gemini with a JSON schema and
  parsing rules, validates the reply with zod, and flags any line that doesn't match the original
  wording.
- **TTS route with caching** ([app/api/tts/route.ts](app/api/tts/route.ts),
  [lib/tts.ts](lib/tts.ts)). Accepts only the app's own voices and lines up to 500 characters,
  turns parentheticals into delivery tags, strips anything in parentheses so actions are never
  spoken, and returns the MP3. The browser caches each clip under a SHA-256 key of voice + model +
  text + parenthetical, so unchanged lines are never generated twice, even after a refresh.
- **Turn-taking** ([lib/rehearsal-machine.ts](lib/rehearsal-machine.ts),
  [lib/voice-detector.ts](lib/voice-detector.ts)). A pure state machine (countdown → costar →
  pause → listening → speaking → silence → next line) plus a speech detector that is fed the mic
  level every 50 ms. Both are plain functions with no browser code, so they're fully unit-tested.
- **Recording** ([lib/recording.ts](lib/recording.ts), [lib/take.ts](lib/take.ts)). Two recorders
  start together: the self-tape (video + mic) and a small audio-only file plus a per-line timing
  log, kept for the upcoming AI critique.

API keys live only on the server (environment variables) and never reach the browser.

## Run it locally

You'll need Node.js 20 or newer, a Gemini API key, and an ElevenLabs API key.

```bash
git clone https://github.com/Nlaroiya/scene-partner.git
cd scene-partner
npm install
```

Create a file named `.env.local` in the project folder (it's git-ignored):

```
APP_PASSCODE=choose-a-passcode
APP_GUEST_PASSCODE=optional-demo-passcode
GEMINI_API_KEY=your-gemini-key
ELEVENLABS_API_KEY=your-elevenlabs-key
```

`APP_GUEST_PASSCODE` is optional: leave it out to turn demo mode off. Then:

```bash
npm run dev    # http://localhost:3000
npm test       # unit tests
```

Use Chrome, Edge or Safari, and allow camera and microphone access when asked.

## Roadmap

- **AI performance notes** (next): send the take's audio and line timings to Gemini, with an
  "Anything the coach should know about you or this audition?" prompt for context, and get
  specific notes on how to improve.
- **Export the finished audition**, ready to send to casting.
- **Multi-scene sessions**, and a **podcast mode** that turns your scenes into audio you can listen
  to for memorisation.
- **Video analysis** of facial expressions and movement.

## Success test

The product works if the AI reads the right lines at the right times on a real audition side,
the feedback is genuinely helpful, and at least one of two or three actor friends who try it on a
real side comes back to use it again.
