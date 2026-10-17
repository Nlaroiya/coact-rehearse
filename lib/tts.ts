// Text-to-speech helpers with no network calls, shared by the browser and the server.
import type { Script } from "./script-schema";

export const MAX_TTS_CHARS = 500;

// Common screenplay parentheticals mapped to ElevenLabs v4 delivery tags.
const DELIVERY_TAGS: Record<string, string> = {
  quieter: "quietly",
  quietly: "quietly",
  softly: "quietly",
  soft: "quietly",
  whispering: "whispers",
  whispers: "whispers",
  whispered: "whispers",
  laughing: "laughs",
  laughs: "laughs",
  sighing: "sighs",
  sighs: "sighs",
  crying: "crying",
  tearful: "crying",
  sarcastic: "sarcastic",
  sarcastically: "sarcastic",
  excited: "excited",
  angry: "angry",
  angrily: "angry",
  shouting: "shouting",
  yelling: "shouting",
};

// Longer unknown parentheticals are usually actions ("BLAIR takes a photo"), which the
// voice may read aloud if sent as a tag, so only short ones become descriptive tags.
const MAX_DESCRIPTIVE_TAG_WORDS = 3;

// Turns "(quieter)" into "[quietly]". Short unknown ones become a descriptive tag,
// e.g. "into phone" → "[into phone]". Returns null when there's nothing safe to use.
export function parentheticalToTag(parenthetical: string | null): string | null {
  if (!parenthetical) return null;
  const cleaned = parenthetical
    .replace(/[()[\]]/g, "") // brackets inside a tag would confuse the model
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned) return null;
  const known = DELIVERY_TAGS[cleaned];
  if (known) return `[${known}]`;
  if (cleaned.split(" ").length > MAX_DESCRIPTIVE_TAG_WORDS) return null;
  return `[${cleaned}]`;
}

// The words to speak from a line: anything in (parentheses) or [brackets] is a stage
// direction or tag that slipped into the dialogue, so it's removed, never spoken.
export function spokenWords(text: string): string {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A line the costar voice (or I) actually say. Dialogue that's only an action,
// e.g. "(BLAIR takes a photo of a cloud)", is treated like a direction.
export function isSpokenLine(line: { type: string; speaker: string | null; text: string }): boolean {
  return line.type === "dialogue" && !!line.speaker && spokenWords(line.text) !== "";
}

// The exact text sent to ElevenLabs. The parenthetical's words are only ever
// used inside a tag, which the model performs instead of reading aloud.
export function speechText(text: string, parenthetical: string | null): string {
  const words = spokenWords(text);
  if (!words) return "";
  const tag = parentheticalToTag(parenthetical);
  return tag ? `${tag} ${words}` : words;
}

// A fingerprint for one clip. Any change to voice, model, text or parenthetical
// gives a new key, so edited lines get new audio and unchanged lines never do.
// The exact spoken text is included too, so if the speaking rules change, only
// the lines whose audio would actually sound different get regenerated.
export async function cacheKey(
  voiceId: string,
  model: string,
  text: string,
  parenthetical: string | null,
): Promise<string> {
  // JSON keeps fields separate, so ("ab", "c") and ("a", "bc") can't collide.
  const input = JSON.stringify([voiceId, model, text, parenthetical, speechText(text, parenthetical)]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Which costar voice reads each character, e.g. { MARCUS: "GhkQ..." }.
export type Casting = Record<string, string>;

export type AudioJob = {
  lineIndex: number;
  key: string;
  voiceId: string;
  text: string;
  parenthetical: string | null;
  chars: number; // characters ElevenLabs will bill, including any tag
};

// Every costar dialogue line with its cache key. Skips my lines and directions.
export async function costarAudioJobs(
  script: Script,
  myCharacter: string,
  casting: Casting,
  model: string,
): Promise<AudioJob[]> {
  const jobs: AudioJob[] = [];
  for (const [lineIndex, line] of script.lines.entries()) {
    if (!isSpokenLine(line) || line.speaker === myCharacter) continue;
    const voiceId = line.speaker && casting[line.speaker];
    if (!voiceId) continue;
    jobs.push({
      lineIndex,
      key: await cacheKey(voiceId, model, line.text, line.parenthetical),
      voiceId,
      text: line.text,
      parenthetical: line.parenthetical,
      chars: speechText(line.text, line.parenthetical).length,
    });
  }
  return jobs;
}

// The costar lines that still need audio: everything not already cached.
export function linesNeedingAudio(jobs: AudioJob[], cachedKeys: Set<string>): AudioJob[] {
  return jobs.filter((job) => !cachedKeys.has(job.key));
}

// Default casting: each costar gets a different voice, in list order.
export function defaultCasting(
  characters: string[],
  myCharacter: string,
  voiceIds: readonly string[],
): Casting {
  const casting: Casting = {};
  characters
    .filter((c) => c !== myCharacter)
    .forEach((c, i) => (casting[c] = voiceIds[i % voiceIds.length]));
  return casting;
}
