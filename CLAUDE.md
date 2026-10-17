# Scene Partner

Web app for actors: upload an audition side, pick your role, an AI voice
reads the other characters, you perform, and AI gives performance notes.
Also exports a self-tape with the reader audio mixed in.
Owner is learning web dev: explain plans before coding, keep changes small,
explain new concepts in plain language, and wait for approval on plans.

## Stack
Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel from GitHub.
- Script parsing: Gemini (gemini-3.5-flash-lite), server-side only
- Costar voices: ElevenLabs (student plan, 131k credits, commercial use OK), server-side only
- Performance critique: Gemini Flash (audio input), server-side only
- No database or user accounts yet. Browser localStorage only.

## Core data shape (do not change without asking)
{ characters: string[],
  lines: { type: "dialogue" | "direction", speaker: string | null,
           parenthetical: string | null, text: string }[] }
Line order in the array = scene order. Directions are never spoken aloud.

## Rules
- API keys live only in .env.local and Vercel env vars. Never in browser
  code, never committed.
- Every page AND every /api route sits behind the passcode gate. If
  APP_PASSCODE is missing, block everyone.
- Never generate the same ElevenLabs line twice: cache audio per line.
- Never commit copyrighted scripts or real audition sides. Only files in
  samples/ (original or public domain) go in the repo.
- Validate all AI responses with zod before using them.
- Add a Vitest test for any logic that doesn't call an external API.

## MVP scope (Nov 1)
IN: parse sides (text + PDF), pick role, ElevenLabs costar voices,
hands-free run with space-bar override, record video + mixed reader audio,
export the take, Gemini audio critique, one notes textbox for context.
OUT (don't build unless asked): accounts, user profiles, video analysis,
podcast mode, voice cloning, mobile layout, AI voice suggestions.

## Commands
npm run dev — local app at localhost:3000
npm test — run tests