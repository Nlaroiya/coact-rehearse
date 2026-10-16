import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findUnmatchedLines, validateScript, type Script } from "./script-schema";

// A saved, known-good reply, so tests never call the real Gemini API.
const sample: Script = JSON.parse(
  readFileSync(new URL("../samples/parse-response.json", import.meta.url), "utf8"),
);
const sourceText = readFileSync(new URL("../samples/study-room.txt", import.meta.url), "utf8");

// Returns a deep copy of the sample so each test can break it without affecting others.
const copy = (): Script => structuredClone(sample);

describe("validateScript", () => {
  it("accepts a valid reply", () => {
    const result = validateScript(sample);
    expect(result.ok).toBe(true);
  });

  it("rejects a reply that isn't an object", () => {
    expect(validateScript("hello").ok).toBe(false);
    expect(validateScript(null).ok).toBe(false);
  });

  it("rejects a reply missing the lines array", () => {
    const result = validateScript({ characters: ["MARCUS"] });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("lines");
  });

  it("rejects an unknown line type", () => {
    const bad = copy() as unknown as { lines: { type: string }[] };
    bad.lines[0].type = "song";
    expect(validateScript(bad).ok).toBe(false);
  });

  it("rejects dialogue with no speaker", () => {
    const bad = copy();
    bad.lines[2].speaker = null;
    const result = validateScript(bad);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("Dialogue needs a speaker");
  });

  it("rejects a direction with a speaker", () => {
    const bad = copy();
    bad.lines[0].speaker = "MARCUS";
    const result = validateScript(bad);
    if (!result.ok) expect(result.error).toContain("Directions must have no speaker");
    expect(result.ok).toBe(false);
  });

  it("rejects a speaker missing from the character list", () => {
    const bad = copy();
    bad.lines[2].speaker = "MARCUS (CONT'D)";
    const result = validateScript(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not in the character list");
  });
});

describe("findUnmatchedLines", () => {
  it("matches every line of the sample, even ones wrapped across lines", () => {
    expect(findUnmatchedLines(sample, sourceText)).toEqual([]);
  });

  it("flags reworded dialogue", () => {
    const reworded = copy();
    reworded.lines[13].text = "I freaked out.";
    expect(findUnmatchedLines(reworded, sourceText)).toEqual([13]);
  });
});
