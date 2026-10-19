import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE, GUEST_BLOCKED_MESSAGE, sessionRole } from "@/lib/auth";
import { MAX_TTS_CHARS, speechText } from "@/lib/tts";
import { isVoiceId, TTS_MODEL } from "@/lib/voices";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

const RequestSchema = z.object({
  text: z.string({ error: "Line text is missing." }).trim().min(1, "Line text is empty.").max(MAX_TTS_CHARS, `Lines can be at most ${MAX_TTS_CHARS} characters.`),
  // Only our four voices, so this route can't be used to spend credits on anything else.
  voiceId: z.string({ error: "Choose a voice." }).refine(isVoiceId, "Unknown voice."),
  parenthetical: z.string().max(100).nullable().optional(),
});

// POST /api/tts  { text, voiceId, parenthetical? }  →  MP3 audio
export async function POST(request: NextRequest) {
  // proxy.ts already blocks logged-out requests; this keeps the route safe on its own.
  const role = await sessionRole(request.cookies.get(AUTH_COOKIE)?.value);
  if (!role) return fail("Not logged in.", 401);
  // Demo (guest) logins can't spend API credits.
  if (role === "guest") return fail(GUEST_BLOCKED_MESSAGE, 403);

  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return fail('Request body must be JSON like {"text": "...", "voiceId": "..."}.', 400);
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }
  const { text, voiceId, parenthetical = null } = parsed.data;
  const spoken = speechText(text, parenthetical);
  if (!spoken) {
    // e.g. "(BLAIR takes a photo of a cloud)": an action, not something to say.
    return fail("This line is only a stage direction, so there's nothing to speak.", 400);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set.");
    return fail("Voices aren't set up on the server yet.", 500);
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: spoken, model_id: TTS_MODEL }),
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (err) {
    console.error("ElevenLabs request failed:", err);
    return fail("Couldn't reach ElevenLabs. Please try again.", 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`ElevenLabs error ${res.status}:`, detail);
    return fail(friendlyError(res.status, detail), res.status === 429 ? 429 : 502);
  }

  console.log(`ElevenLabs: ${res.headers.get("character-cost") ?? "?"} characters billed`);

  // Check that ElevenLabs really sent audio before passing it on.
  const audio = await res.arrayBuffer();
  if (!res.headers.get("content-type")?.startsWith("audio/") || audio.byteLength === 0) {
    console.error("ElevenLabs returned no audio. Content-Type:", res.headers.get("content-type"));
    return fail("ElevenLabs sent back an empty reply. Please try again.", 502);
  }

  return new NextResponse(audio, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}

function friendlyError(status: number, detail: string): string {
  if (detail.includes("quota_exceeded")) return "You're out of ElevenLabs credits for this month.";
  if (status === 401) return "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY.";
  if (status === 402) return "Your ElevenLabs plan doesn't allow this voice through the API.";
  if (status === 404) return "ElevenLabs couldn't find that voice. Try adding it to My Voices in ElevenLabs.";
  if (status === 429) return "ElevenLabs is busy or rate-limiting. Wait a moment and try again.";
  return "ElevenLabs couldn't generate this line. Please try again.";
}
