import { describe, expect, it } from "vitest";
import {
  buildTimingLog,
  CRITIQUE_FORMATS,
  pickFormat,
  slugify,
  suggestSceneName,
  takeFilename,
  TAPE_FORMATS,
  type TakeEvent,
} from "./take";

describe("pickFormat", () => {
  const supports = (...types: string[]) => (t: string) => types.includes(t);

  it("prefers MP4 (H.264 + AAC) when the browser supports it", () => {
    const all = (t: string) => TAPE_FORMATS.some((f) => f.mimeType === t);
    expect(pickFormat(TAPE_FORMATS, all)).toMatchObject({ ext: "mp4", label: "MP4 (H.264 + AAC)" });
  });

  it("falls back through the list in order", () => {
    expect(pickFormat(TAPE_FORMATS, supports("video/mp4"))?.label).toBe("MP4");
    expect(pickFormat(TAPE_FORMATS, supports("video/webm;codecs=vp8,opus", "video/webm"))).toMatchObject({ ext: "webm", label: "WebM (VP8 + Opus)" });
  });

  it("uses WebM when MP4 isn't available (e.g. Firefox)", () => {
    expect(pickFormat(TAPE_FORMATS, supports("video/webm;codecs=vp9,opus"))?.ext).toBe("webm");
  });

  it("returns null when nothing is supported", () => {
    expect(pickFormat(TAPE_FORMATS, () => false)).toBeNull();
  });

  it("critique audio prefers small WebM/Opus, then M4A (both accepted by Gemini)", () => {
    expect(pickFormat(CRITIQUE_FORMATS, () => true)?.mimeType).toBe("audio/webm;codecs=opus");
    expect(pickFormat(CRITIQUE_FORMATS, supports("audio/mp4"))?.ext).toBe("m4a"); // e.g. Safari
  });
});

describe("filename", () => {
  const date = new Date(2026, 9, 16, 23, 59); // 16 Oct 2026, local time

  it("matches the self-tape naming pattern", () => {
    expect(takeFilename("study-room", "PRIYA", 2, date, "mp4")).toBe("study-room_PRIYA_take2_2026-10-16.mp4");
  });

  it("cleans up scene names and roles with spaces and punctuation", () => {
    expect(takeFilename("The Study Room: Night!", "mary jane", 1, date, "webm")).toBe("the-study-room-night_MARY-JANE_take1_2026-10-16.webm");
  });

  it("pads single-digit months and days", () => {
    expect(takeFilename("x", "A", 3, new Date(2027, 0, 5), "mp4")).toBe("x_A_take3_2027-01-05.mp4");
  });

  it("never produces an empty part", () => {
    expect(takeFilename("!!!", "???", 1, date, "mp4")).toBe("scene_ME_take1_2026-10-16.mp4");
  });

  it("slugify handles accents and long names", () => {
    expect(slugify("Café Scène")).toBe("cafe-scene");
    expect(slugify("a".repeat(100)).length).toBe(60);
  });
});

describe("suggestSceneName", () => {
  const lines = [
    { type: "direction", text: "INT. UNIVERSITY LIBRARY STUDY ROOM - NIGHT" },
    { type: "dialogue", text: "Hi." },
  ];

  it("uses the PDF's file name first", () => {
    expect(suggestSceneName("Study Room Sides v2.pdf", lines)).toBe("study-room-sides-v2");
  });

  it("otherwise uses the first scene heading, without INT./EXT. and the time of day", () => {
    expect(suggestSceneName(null, lines)).toBe("university-library-study-room");
    expect(suggestSceneName(null, [{ type: "direction", text: "EXT. ROOFTOP - DAY" }])).toBe("rooftop");
  });

  it("falls back to 'scene'", () => {
    expect(suggestSceneName(null, [{ type: "direction", text: "She waits." }])).toBe("scene");
  });
});

describe("buildTimingLog", () => {
  const START = 10_000; // performance.now() when recording started
  const at = (ms: number) => START + ms;
  const date = new Date("2026-10-16T20:00:00Z");

  it("hands-free take: costar lines by clip, my lines from turn start to when I stopped speaking", () => {
    const events: TakeEvent[] = [
      { t: at(0), kind: "recordingStart" },
      { t: at(40), kind: "costarStart", lineIndex: 2, speaker: "MARCUS" },
      { t: at(2040), kind: "costarEnd", lineIndex: 2 },
      { t: at(2300), kind: "myTurnStart", lineIndex: 3, speaker: "PRIYA" },
      { t: at(2900), kind: "speechStart", lineIndex: 3 },
      { t: at(3400), kind: "silenceStart", lineIndex: 3 }, // a mid-line pause...
      { t: at(3700), kind: "speechResume", lineIndex: 3 }, // ...then I carry on
      { t: at(4500), kind: "silenceStart", lineIndex: 3 }, // I finish here
      { t: at(5750), kind: "myLineEnd", lineIndex: 3, by: "silence" },
      { t: at(6100), kind: "costarStart", lineIndex: 4, speaker: "MARCUS" },
      { t: at(8100), kind: "costarEnd", lineIndex: 4 },
    ];
    expect(buildTimingLog(events, date)).toEqual({
      recordingStartedAt: "2026-10-16T20:00:00.000Z",
      lines: [
        { index: 2, speaker: "MARCUS", mine: false, startMs: 40, speechStartMs: null, endMs: 2040, endedBy: "clip" },
        { index: 3, speaker: "PRIYA", mine: true, startMs: 2300, speechStartMs: 2900, endMs: 4500, endedBy: "silence" },
        { index: 4, speaker: "MARCUS", mine: false, startMs: 6100, speechStartMs: null, endMs: 8100, endedBy: "clip" },
      ],
    });
  });

  it("keyboard take: my line ends when I press Space, with no speech times", () => {
    const events: TakeEvent[] = [
      { t: at(0), kind: "recordingStart" },
      { t: at(0), kind: "myTurnStart", lineIndex: 0, speaker: "PRIYA" },
      { t: at(3000), kind: "myLineEnd", lineIndex: 0, by: "key" },
    ];
    expect(buildTimingLog(events, date).lines).toEqual([
      { index: 0, speaker: "PRIYA", mine: true, startMs: 0, speechStartMs: null, endMs: 3000, endedBy: "key" },
    ]);
  });

  it("Space during a pause ends the line at the key press, not the earlier silence", () => {
    const events: TakeEvent[] = [
      { t: at(0), kind: "recordingStart" },
      { t: at(100), kind: "myTurnStart", lineIndex: 1, speaker: "PRIYA" },
      { t: at(500), kind: "speechStart", lineIndex: 1 },
      { t: at(1500), kind: "silenceStart", lineIndex: 1 },
      { t: at(2000), kind: "myLineEnd", lineIndex: 1, by: "key" },
    ];
    expect(buildTimingLog(events, date).lines[0]).toMatchObject({ endMs: 2000, endedBy: "key" });
  });

  it("Stop mid-line keeps the partial line, marked as stopped", () => {
    const events: TakeEvent[] = [
      { t: at(0), kind: "recordingStart" },
      { t: at(50), kind: "costarStart", lineIndex: 2, speaker: "MARCUS" },
      { t: at(900), kind: "stop" },
    ];
    expect(buildTimingLog(events, date).lines).toEqual([
      { index: 2, speaker: "MARCUS", mine: false, startMs: 50, speechStartMs: null, endMs: 900, endedBy: "stopped" },
    ]);
  });

  it("two costar lines in a row are separate entries", () => {
    const events: TakeEvent[] = [
      { t: at(0), kind: "recordingStart" },
      { t: at(0), kind: "costarStart", lineIndex: 7, speaker: "MARCUS" },
      { t: at(1500), kind: "costarEnd", lineIndex: 7 },
      { t: at(1800), kind: "costarStart", lineIndex: 9, speaker: "MARCUS" },
      { t: at(3000), kind: "costarEnd", lineIndex: 9 },
    ];
    expect(buildTimingLog(events, date).lines.map((l) => [l.index, l.startMs, l.endMs])).toEqual([[7, 0, 1500], [9, 1800, 3000]]);
  });

  it("ignores anything before the recording started, and returns nothing without a start", () => {
    const events: TakeEvent[] = [
      { t: at(-500), kind: "myTurnStart", lineIndex: 0, speaker: "PRIYA" },
      { t: at(0), kind: "recordingStart" },
      { t: at(10), kind: "costarStart", lineIndex: 2, speaker: "MARCUS" },
      { t: at(20), kind: "costarEnd", lineIndex: 2 },
    ];
    expect(buildTimingLog(events, date).lines.map((l) => l.index)).toEqual([2]);
    expect(buildTimingLog(events.slice(2), date).lines).toEqual([]);
  });
});
