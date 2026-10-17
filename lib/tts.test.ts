import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Script } from "./script-schema";
import {
  cacheKey,
  costarAudioJobs,
  defaultCasting,
  isSpokenLine,
  linesNeedingAudio,
  parentheticalToTag,
  speechText,
  spokenWords,
} from "./tts";

const script: Script = JSON.parse(
  readFileSync(new URL("../samples/parse-response.json", import.meta.url), "utf8"),
);
const MODEL = "eleven_v4";
const KYLE = "GhkQkxbimoIykF4iGYqh";
const CAROLINE = "yK2Ny0mq8WplixhD1td3";

describe("cacheKey", () => {
  it("is the same for the same input", async () => {
    expect(await cacheKey(KYLE, MODEL, "Hi.", null)).toBe(await cacheKey(KYLE, MODEL, "Hi.", null));
  });

  it("is a 64-character hex string", async () => {
    expect(await cacheKey(KYLE, MODEL, "Hi.", null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any single field changes", async () => {
    const base = await cacheKey(KYLE, MODEL, "Hi.", "quieter");
    const variants = await Promise.all([
      cacheKey(CAROLINE, MODEL, "Hi.", "quieter"),
      cacheKey(KYLE, "eleven_v3", "Hi.", "quieter"),
      cacheKey(KYLE, MODEL, "Hi!", "quieter"),
      cacheKey(KYLE, MODEL, "Hi.", "louder"),
      cacheKey(KYLE, MODEL, "Hi.", null),
    ]);
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it("doesn't confuse no parenthetical with an empty one", async () => {
    expect(await cacheKey(KYLE, MODEL, "Hi.", null)).not.toBe(await cacheKey(KYLE, MODEL, "Hi.", ""));
  });

  it("changes when the words actually spoken change", async () => {
    // Same four inputs except a stripped action: the old wrong clip must not be reused.
    const plain = await cacheKey(KYLE, MODEL, "Very.", null);
    const withAction = await cacheKey(KYLE, MODEL, "(BLAIR takes a photo) Very.", null);
    expect(withAction).not.toBe(plain);
  });

  it("keeps fields separate, so shifted text can't collide", async () => {
    expect(await cacheKey("ab", MODEL, "c", null)).not.toBe(await cacheKey("a", MODEL, "bc", null));
  });
});

describe("parentheticalToTag / speechText", () => {
  it("maps known delivery words", () => {
    expect(parentheticalToTag("quieter")).toBe("[quietly]");
    expect(parentheticalToTag(" Whispering ")).toBe("[whispers]");
  });

  it("turns unknown parentheticals into a descriptive tag", () => {
    expect(parentheticalToTag("into phone")).toBe("[into phone]");
  });

  it("strips brackets and handles empty input", () => {
    expect(parentheticalToTag("(beat)")).toBe("[beat]");
    expect(parentheticalToTag("  ")).toBeNull();
    expect(parentheticalToTag(null)).toBeNull();
  });

  it("gives long, action-like parentheticals no tag", () => {
    expect(parentheticalToTag("BLAIR takes a photo of a cloud")).toBeNull();
    expect(parentheticalToTag("not looking up")).toBe("[not looking up]");
    expect(speechText("Very.", "BLAIR takes a photo of a cloud")).toBe("Very.");
  });

  it("never speaks parenthesized actions that slipped into the dialogue", () => {
    expect(speechText("(BLAIR takes a photo of a cloud) Very.", null)).toBe("Very.");
    expect(speechText("Fine. (He sits up.) Happy now?", null)).toBe("Fine. Happy now?");
    expect(spokenWords("Wait [beat] what?")).toBe("Wait what?");
  });

  it("treats a line that's only an action as unspoken", () => {
    expect(speechText("(BLAIR takes a photo of a cloud)", "smiling")).toBe("");
    expect(isSpokenLine({ type: "dialogue", speaker: "BLAIR", text: "(BLAIR takes a photo of a cloud)" })).toBe(false);
    expect(isSpokenLine({ type: "dialogue", speaker: "BLAIR", text: "Very." })).toBe(true);
    expect(isSpokenLine({ type: "direction", speaker: null, text: "Very." })).toBe(false);
  });

  it("puts the tag before the line and never adds the parenthetical as plain text", () => {
    expect(speechText("Was it something I did?", "quieter")).toBe("[quietly] Was it something I did?");
    expect(speechText("I panicked.", null)).toBe("I panicked.");
  });
});

describe("costarAudioJobs / linesNeedingAudio", () => {
  const casting = { MARCUS: KYLE };

  it("includes only the other characters' dialogue, in scene order", async () => {
    const jobs = await costarAudioJobs(script, "PRIYA", casting, MODEL);
    expect(jobs.map((j) => j.lineIndex)).toEqual([2, 4, 7, 9, 13]);
    expect(jobs.every((j) => j.voiceId === KYLE)).toBe(true);
    expect(jobs.map((j) => script.lines[j.lineIndex].speaker)).toEqual(Array(5).fill("MARCUS"));
  });

  it("counts billed characters including the delivery tag", async () => {
    const jobs = await costarAudioJobs(script, "PRIYA", casting, MODEL);
    const quiet = jobs.find((j) => j.lineIndex === 9)!;
    expect(quiet.chars).toBe("[quietly] Was it something I did?".length);
  });

  it("skips lines already in the cache", async () => {
    const jobs = await costarAudioJobs(script, "PRIYA", casting, MODEL);
    const cached = new Set([jobs[0].key, jobs[2].key]);
    expect(linesNeedingAudio(jobs, cached).map((j) => j.lineIndex)).toEqual([4, 9, 13]);
    expect(linesNeedingAudio(jobs, new Set(jobs.map((j) => j.key)))).toEqual([]);
  });

  it("only needs the edited line after an edit", async () => {
    const before = await costarAudioJobs(script, "PRIYA", casting, MODEL);
    const edited = structuredClone(script);
    edited.lines[4].text = "Forty messages, Priya!";
    const after = await costarAudioJobs(edited, "PRIYA", casting, MODEL);
    const needed = linesNeedingAudio(after, new Set(before.map((j) => j.key)));
    expect(needed.map((j) => j.lineIndex)).toEqual([4]);
  });

  it("needs every line again when the costar's voice changes", async () => {
    const before = await costarAudioJobs(script, "PRIYA", casting, MODEL);
    const after = await costarAudioJobs(script, "PRIYA", { MARCUS: CAROLINE }, MODEL);
    expect(linesNeedingAudio(after, new Set(before.map((j) => j.key)))).toHaveLength(5);
  });

  it("gives action-only costar lines no audio job", async () => {
    const withAction = structuredClone(script);
    withAction.lines[4].text = "(MARCUS takes a photo of a cloud)";
    const jobs = await costarAudioJobs(withAction, "PRIYA", casting, MODEL);
    expect(jobs.map((j) => j.lineIndex)).toEqual([2, 7, 9, 13]);
  });

  it("switches sides when I play MARCUS instead", async () => {
    const jobs = await costarAudioJobs(script, "MARCUS", { PRIYA: CAROLINE }, MODEL);
    expect(jobs.map((j) => j.lineIndex)).toEqual([3, 6, 11, 14]);
  });
});

describe("defaultCasting", () => {
  it("gives each costar a different voice and skips me", () => {
    expect(defaultCasting(["A", "B", "C"], "B", ["v1", "v2", "v3"])).toEqual({ A: "v1", C: "v2" });
  });

  it("wraps around when there are more costars than voices", () => {
    expect(defaultCasting(["A", "B", "C"], "", ["v1", "v2"])).toEqual({ A: "v1", B: "v2", C: "v1" });
  });
});
