// Demo mode (guest passcode): a pre-loaded scene with pre-generated voice audio, so guests
// can try everything without spending API credits. The audio lives in public/demo/, named by
// the same cache key the app uses, and is loaded into the browser's audio cache on demand.
import demoScript from "../samples/parse-response.json";
import { ScriptSchema, type Script } from "./script-schema";
import type { Casting } from "./tts";

export const DEMO_SCRIPT: Script = ScriptSchema.parse(demoScript); // study-room.txt, parsed
export const DEMO_SCENE_NAME = "study-room";
// Fixed voices, since only these were generated: MARCUS = Kyle, PRIYA = Caroline Braden.
export const DEMO_CASTING: Casting = { MARCUS: "GhkQkxbimoIykF4iGYqh", PRIYA: "yK2Ny0mq8WplixhD1td3" };

export const demoClipUrl = (key: string) => `/demo/${key}.mp3`;
