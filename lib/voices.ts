// ElevenLabs costar voices. Voice IDs aren't secret, so the browser can use this list too.
export const TTS_MODEL = "eleven_v4";

export const VOICES = [
  { id: "GhkQkxbimoIykF4iGYqh", name: "Kyle", description: "Young male" },
  { id: "yK2Ny0mq8WplixhD1td3", name: "Caroline Braden", description: "Young female" },
  { id: "6rr4jpS124uCLNtgVdAk", name: "Chris Heyez", description: "Middle-aged male" },
  { id: "oT5lntmfa8t37GiBBd3k", name: "Stephanie", description: "Middle-aged female" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

export function isVoiceId(id: string): id is VoiceId {
  return VOICES.some((v) => v.id === id);
}
