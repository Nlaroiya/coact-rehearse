# Next session

## Where things are (Oct 18)
- Code is on GitHub (`Nlaroiya/coact-rehearse`, renamed from scene-partner), with a README for sharing. Making the repo
  public is done in GitHub → Settings → Danger Zone.
- Live on Vercel: find the link in the Vercel dashboard → the project (named scene-partner
  unless you renamed it there too) → Domains.
  (Not scene-partner.vercel.app, which is someone else's site.)
- Vercel environment variables: APP_PASSCODE, GEMINI_API_KEY, ELEVENLABS_API_KEY, plus
  APP_GUEST_PASSCODE for demo mode (add it in Vercel, then redeploy).
- Run locally: `npm run dev` → http://localhost:3000. Tests: `npm test` (123 passing).

## What works
- Passcode gate on every page and API route (blocks everyone if APP_PASSCODE is missing).
- Paste a side or upload a PDF (up to 3MB) → Gemini parses it → editable lines, saved on refresh.
  Stage directions in parentheses are never read aloud, in screenplay or "NAME: line" format.
- ElevenLabs costar voices (Eleven v4), cached per line in the browser so a line is never
  generated twice. "Prepare scene" shows the credits before generating.
- Rehearse mode: pick your role and costar voices, costar speed, cue pickup (also the pause
  between two costar lines), 3-2-1 countdown, Stop.
- Hands-free: the mic notices when your line ends (silence threshold slider); Space, Page Down
  or Right Arrow always end your line. Adapts to background noise that starts mid-scene.
  Live mic meter with the threshold marker.
- Recording: camera + mic at 720p, mirrored preview, unmirrored MP4 recording. The reader is
  picked up from the speakers (Reader volume, default 80%). Playback, Download
  (e.g. study-room_PRIYA_take2_2026-10-16.mp4), Retake (no audio regenerated).
- Demo mode: logging in with the guest passcode (APP_GUEST_PASSCODE) opens the pre-loaded
  "Study Room" scene with pre-generated voices in public/demo/ (139 credits, generated once).
  Guests can rehearse, use hands-free and record, but the server refuses /api/parse and
  /api/tts for them, so they can't spend credits. Change or remove the variable in Vercel to
  cut off guest access.
- For Task 5: each take keeps a small critique audio file (WebM/Opus, mic only) and a line
  timing log (JSON) in memory. Nothing is uploaded yet.

## Voices (all Eleven v4)
- Young male: Kyle (GhkQkxbimoIykF4iGYqh)
- Young female: Caroline Braden (yK2Ny0mq8WplixhD1td3)
- Middle-aged male: Chris Heyez (6rr4jpS124uCLNtgVdAk)
- Middle-aged female: Stephanie (oT5lntmfa8t37GiBBd3k)
- Credits: 121,000 ElevenLabs credits per month for three months. The study-room scene as
  PRIYA costs about 80 credits to prepare. The live site and localhost each have their own
  audio cache, so each prepares a scene once.

## Known issues / notes
- Fixed: background noise starting mid-scene (e.g. a sink) kept lines from ending. The
  threshold now follows the room's quietest moments and never rises above your own voice;
  a noise spike has to last over 100ms to count as talking.
- Removed Headphones mode (not needed). It's in Git history if it's ever wanted back.
- Chrome sometimes picks the iPhone mic (Continuity). Choose the mic and camera in Chrome's
  site settings (icon left of the address bar).
- A development-only diagnostic logs the mic levels once per second to
  `.next/dev/logs/next-development.log` (kept on purpose; it doesn't run on the live site).

## Next: Task 5 — Performance notes
- Send the take's critique audio + line timing log (+ a notes textbox for context) to Gemini
  Flash, server-side, and show notes on how to improve. Validate the response with zod.
