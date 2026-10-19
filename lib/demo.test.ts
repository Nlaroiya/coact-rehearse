import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_CASTING, DEMO_SCRIPT } from "./demo";
import { costarAudioJobs } from "./tts";
import { TTS_MODEL } from "./voices";

const manifest = JSON.parse(readFileSync(new URL("../public/demo/manifest.json", import.meta.url), "utf8"));

describe("demo scene audio", () => {
  it("every costar line, for either role, has a bundled clip with the matching cache key", async () => {
    for (const me of DEMO_SCRIPT.characters) {
      const jobs = await costarAudioJobs(DEMO_SCRIPT, me, DEMO_CASTING, TTS_MODEL);
      expect(jobs.length).toBeGreaterThan(0);
      for (const job of jobs) {
        expect(existsSync(new URL(`../public/demo/${job.key}.mp3`, import.meta.url))).toBe(true);
      }
    }
  });

  it("the manifest lists exactly those clips, made with the app's current model and voices", async () => {
    const all = [
      ...(await costarAudioJobs(DEMO_SCRIPT, "PRIYA", DEMO_CASTING, TTS_MODEL)),
      ...(await costarAudioJobs(DEMO_SCRIPT, "MARCUS", DEMO_CASTING, TTS_MODEL)),
    ];
    expect(manifest.model).toBe(TTS_MODEL);
    expect(manifest.casting).toEqual(DEMO_CASTING);
    expect(manifest.clips.map((c: { key: string }) => c.key).sort()).toEqual(all.map((j) => j.key).sort());
  });

  it("the demo scene is the study-room sample with both roles", () => {
    expect(DEMO_SCRIPT.characters).toEqual(["MARCUS", "PRIYA"]);
    expect(DEMO_SCRIPT.lines[0].text).toBe("INT. UNIVERSITY LIBRARY STUDY ROOM - NIGHT");
  });
});
