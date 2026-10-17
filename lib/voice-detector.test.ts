import { describe, expect, it } from "vitest";
import { IDLE, reduce, type RunEvent, type RunState } from "./rehearsal-machine";
import {
  BELOW_VOICE_DB,
  calibrateThreshold,
  detect,
  FRAME_MS,
  levelDb,
  MAX_THRESHOLD_DB,
  MIN_THRESHOLD_DB,
  START_DETECTOR,
  startNoiseTracker,
  trackedThreshold,
  trackLevel,
  type DetectorEvent,
} from "./voice-detector";

const THRESHOLD = -40;
const SILENCE_LIMIT = 1200; // the default Silence threshold, in ms
const QUIET = -60;
const VOICE = -25;

// A fake mic: `ms` milliseconds at a given level, as 50ms frames.
const frames = (level: number, ms: number) => Array<number>(ms / FRAME_MS).fill(level);

// Feeds levels through the detector and returns every event with when it happened.
function feed(levels: number[], limit = SILENCE_LIMIT) {
  let state = START_DETECTOR;
  const events: { event: DetectorEvent; atMs: number }[] = [];
  levels.forEach((level, i) => {
    const out = detect(state, level, THRESHOLD, limit);
    state = out.state;
    if (out.event) events.push({ event: out.event, atMs: (i + 1) * FRAME_MS });
  });
  return { state, events, names: events.map((e) => e.event) };
}

describe("levelDb", () => {
  it("measures loudness in dBFS", () => {
    expect(levelDb(new Float32Array(1024).fill(1))).toBeCloseTo(0);
    expect(levelDb(new Float32Array(1024).fill(0.1))).toBeCloseTo(-20);
    expect(levelDb(new Float32Array(1024))).toBe(-100); // pure silence
  });
});

describe("calibrateThreshold", () => {
  it("sets the threshold 8 dB above the room's noise", () => {
    expect(calibrateThreshold(frames(-55, 2000))).toBe(-47);
  });

  it("uses the louder end of the noise, not a lucky quiet moment", () => {
    const noise = [...frames(-70, 1000), ...frames(-52, 1000)];
    expect(calibrateThreshold(noise)).toBe(-44);
  });

  it("stays within sensible limits for very quiet and very noisy rooms", () => {
    expect(calibrateThreshold(frames(-90, 2000))).toBe(MIN_THRESHOLD_DB);
    expect(calibrateThreshold(frames(-20, 2000))).toBe(MAX_THRESHOLD_DB);
    expect(calibrateThreshold([])).toBe(MIN_THRESHOLD_DB);
  });
});

describe("speech and silence detection", () => {
  it("a clear line: speech starts after 300ms and ends after 1.2s of silence", () => {
    const { events } = feed([...frames(QUIET, 500), ...frames(VOICE, 2000), ...frames(QUIET, 2000)]);
    expect(events).toEqual([
      { event: "speechStart", atMs: 800 }, // 500ms quiet + 300ms of speech
      { event: "silenceStart", atMs: 2550 }, // the first quiet frame (2500–2550ms)
      { event: "lineEnd", atMs: 3750 }, // 1250ms of quiet: the first moment it's *longer* than 1.2s
    ]);
  });

  it("a breath before speaking is ignored", () => {
    const breath = frames(VOICE, 200); // 200ms: too short to be speech
    const { events } = feed([...frames(QUIET, 300), ...breath, ...frames(QUIET, 500), ...frames(VOICE, 1500), ...frames(QUIET, 1500)]);
    expect(events[0]).toEqual({ event: "speechStart", atMs: 1300 }); // the real line, not the breath
    expect(events.map((e) => e.event)).toEqual(["speechStart", "silenceStart", "lineEnd"]);
  });

  it("clicks and breaths alone never start my turn", () => {
    // 20 clicks over 10s: none starts speech (the 10s "waiting" message is expected).
    const clicks = Array.from({ length: 20 }, () => [...frames(VOICE, 150), ...frames(QUIET, 350)]).flat();
    expect(feed(clicks).names).not.toContain("speechStart");
  });

  it("tiny dips between syllables don't break up the start of speech", () => {
    const wobbly = [...frames(VOICE, 150), ...frames(QUIET, 100), ...frames(VOICE, 150)];
    expect(feed(wobbly).names).toEqual(["speechStart"]);
  });

  it("a mid-line pause shorter than the threshold does not end the line", () => {
    const line = [...frames(VOICE, 1000), ...frames(QUIET, 800), ...frames(VOICE, 1000), ...frames(QUIET, 1500)];
    const { names } = feed(line);
    expect(names).toEqual(["speechStart", "silenceStart", "speechResume", "silenceStart", "lineEnd"]);
  });

  it("speaking again before the threshold keeps the line; a pause just over it ends it", () => {
    // Resuming takes 100ms of sound, and the first 50ms of it still counts as silence.
    expect(feed([...frames(VOICE, 500), ...frames(QUIET, 1150), ...frames(VOICE, 100)]).names).not.toContain("lineEnd");
    expect(feed([...frames(VOICE, 500), ...frames(QUIET, 1250)]).names).toContain("lineEnd");
  });

  it("a single clink or drip during a pause doesn't restart the silence count", () => {
    const spikes = [...frames(QUIET, 400), ...frames(VOICE, 50), ...frames(QUIET, 400), ...frames(VOICE, 50), ...frames(QUIET, 400)];
    const { events } = feed([...frames(VOICE, 1000), ...spikes]);
    expect(events.map((e) => e.event)).toEqual(["speechStart", "silenceStart", "lineEnd"]);
    expect(events[2].atMs).toBe(1000 + 1250); // the same as a clean pause
  });

  it("follows the Silence threshold slider", () => {
    const line = [...frames(VOICE, 500), ...frames(QUIET, 800)];
    expect(feed(line, 600).names).toContain("lineEnd");
    expect(feed(line, 3000).names).not.toContain("lineEnd");
  });

  it("after 10s with no speech it says 'waiting' once, and never ends the line", () => {
    const { events, state } = feed(frames(QUIET, 15000));
    expect(events).toEqual([{ event: "waiting", atMs: 10000 }]);
    expect(state.phase).toBe("beforeSpeech");
  });

  it("speech after 'waiting' still starts the line normally", () => {
    expect(feed([...frames(QUIET, 11000), ...frames(VOICE, 400)]).names).toEqual(["waiting", "speechStart"]);
  });
});

// A realistic fake voice, with a fixed random seed so every test run is identical:
// syllables around `voiceDb`, short dips between syllables, gaps between words, and a
// breath between phrases. `floor` is what the room sounds like in the gaps.
function makeRandom(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}
function speech(seconds: number, opts: { voiceDb?: number; floor?: () => number; seed?: number } = {}) {
  const rand = makeRandom(opts.seed ?? 7);
  const voiceDb = opts.voiceDb ?? -30;
  const floor = opts.floor ?? (() => -59 + rand() * 3);
  const out: number[] = [];
  while (out.length * FRAME_MS < seconds * 1000) {
    const syllable = 3 + Math.floor(rand() * 3); // 150–250ms
    for (let i = 0; i < syllable; i++) out.push(voiceDb + (rand() - 0.5) * 8);
    out.push(Math.max(voiceDb - 10 + rand() * 4, floor())); // dip between syllables
    if (rand() < 0.25) out.push(Math.max(voiceDb - 16 + rand() * 4, floor())); // gap between words
    if (rand() < 0.06) for (let i = 0; i < 6; i++) out.push(floor() + 2); // breath between phrases
  }
  return out;
}

describe("tracked threshold (background noise that changes mid-scene)", () => {
  const ROOM = -59;
  const rand = makeRandom(3);
  const room = (ms: number) => Array.from({ length: ms / FRAME_MS }, () => ROOM + rand() * 3);
  const SINK = () => -51.5 + rand() * 6; // a running sink: -51.5 to -45.5 dB
  const sink = (ms: number) => Array.from({ length: ms / FRAME_MS }, SINK);
  // A sink that wobbles: 150ms above the countdown's threshold, 150ms below, over and over.
  // Too long to be ignored as a spike, so on its own it keeps "resuming" my line.
  const wobblySink = (ms: number) => Array.from({ length: ms / FRAME_MS }, (_, i) => (i % 6 < 3 ? -44 : -50));
  const countdown = room(2000);
  const CALIBRATED = calibrateThreshold(countdown); // ≈ -46 dB

  // What the page does every 50ms on my turn: track the level, then detect with the new threshold.
  function perform(levels: number[]) {
    let tracker = startNoiseTracker(countdown, CALIBRATED);
    let state = START_DETECTOR;
    const thresholds: number[] = [];
    const names: DetectorEvent[] = [];
    for (const level of levels) {
      tracker = trackLevel(tracker, level, CALIBRATED);
      const threshold = trackedThreshold(tracker, CALIBRATED);
      thresholds.push(threshold);
      const out = detect(state, level, threshold, SILENCE_LIMIT);
      state = out.state;
      if (out.event) names.push(out.event);
    }
    return { names, thresholds, maxThreshold: Math.max(...thresholds), tracker };
  }
  const shareAbove = (levels: number[], thresholds: number[]) =>
    levels.filter((l, i) => l >= thresholds[i]).length / levels.length;

  it("without adapting, a sink bouncing over the threshold means my line never ends", () => {
    let state = START_DETECTOR;
    const names: string[] = [];
    for (const level of [...speech(2), ...wobblySink(10000)]) {
      const out = detect(state, level, CALIBRATED, SILENCE_LIMIT);
      state = out.state;
      if (out.event) names.push(out.event);
    }
    expect(names).not.toContain("lineEnd"); // the first bug you hit
  });

  it("8s of normal, continuous talking stays in the green (the bug you just hit)", () => {
    const voice = speech(8);
    const { thresholds, maxThreshold, names } = perform(voice);
    expect(maxThreshold).toBeLessThan(-38); // it used to climb to about -27 dB, above my voice
    const syllables = voice.filter((l) => l > -36);
    expect(syllables.every((l) => l >= maxThreshold)).toBe(true); // every syllable reaches the green
    expect(shareAbove(voice, thresholds)).toBeGreaterThan(0.85);
    expect(names[0]).toBe("speechStart");
    expect(names).not.toContain("lineEnd"); // no early cut-off mid-speech
  });

  it("a 20s monologue never pushes the threshold up to my voice", () => {
    const { maxThreshold, tracker } = perform(speech(20, { seed: 11 }));
    const myVoice = [...tracker.voice].sort((a, b) => a - b)[tracker.voice.length >> 1];
    expect(maxThreshold).toBeLessThanOrEqual(myVoice - BELOW_VOICE_DB + 0.01);
  });

  it("a soft-spoken actor (voice ≈ -42 dB) still registers and the line still ends", () => {
    const { names } = perform([...speech(4, { voiceDb: -40 }), ...room(2000)]);
    expect(names[0]).toBe("speechStart");
    expect(names).toContain("lineEnd");
  });

  it("the sink starts mid-line: the threshold rises above it and my line ends", () => {
    const { names, thresholds } = perform([...speech(2), ...speech(3, { floor: SINK }), ...sink(5000)]);
    expect(names).toContain("lineEnd");
    expect(thresholds.at(-1)!).toBeGreaterThan(-45.5); // above the sink's loudest moments
  });

  it("the wobbly sink that used to get stuck: with adapting, my line ends", () => {
    const { names, thresholds } = perform([...speech(2), ...wobblySink(8000)]);
    expect(names).toContain("lineEnd");
    expect(thresholds.at(-1)!).toBeGreaterThan(-44); // above the wobble's peaks
  });

  it("talking normally WHILE the sink runs: still green, and the line still ends", () => {
    const before = sink(3000); // the sink was already on in the pause before my turn
    const voice = speech(6, { floor: SINK, seed: 5 });
    const { names, thresholds } = perform([...before, ...voice, ...sink(4000)]);
    const during = thresholds.slice(before.length, before.length + voice.length);
    expect(voice.filter((l) => l > -36).every((l) => l >= Math.max(...during))).toBe(true);
    expect(names.filter((n) => n === "speechStart")).toHaveLength(1); // the sink alone didn't start my line
    expect(names).toContain("lineEnd");
  });

  it("never drops below the countdown's measurement when the room gets quieter", () => {
    const { thresholds } = perform(Array<number>(200).fill(-90));
    expect(Math.min(...thresholds)).toBe(CALIBRATED);
  });

  it("never rises above the -25 dB cap, so speech is always possible", () => {
    const { maxThreshold } = perform(Array<number>(200).fill(-20)); // extremely loud steady noise
    expect(maxThreshold).toBeLessThanOrEqual(MAX_THRESHOLD_DB);
  });

  it("waits for 1s of levels before adapting", () => {
    let tracker = startNoiseTracker([], CALIBRATED);
    // -50 dB: louder than the countdown's room, but too quiet to be my voice, so it's noise.
    for (let i = 0; i < 19; i++) tracker = trackLevel(tracker, -50, CALIBRATED);
    expect(trackedThreshold(tracker, CALIBRATED)).toBe(CALIBRATED);
    tracker = trackLevel(tracker, -50, CALIBRATED);
    expect(trackedThreshold(tracker, CALIBRATED)).toBeCloseTo(-42); // -50 + 8
  });
});

// The detector's events, as the page translates them for the state machine.
const toRunEvent: Record<DetectorEvent, RunEvent["type"]> = {
  speechStart: "SPEECH_START",
  silenceStart: "SILENCE_START",
  speechResume: "SPEECH_RESUME",
  lineEnd: "SILENCE_DONE",
  waiting: "NO_SPEECH_YET",
};

describe("detector + state machine together", () => {
  const stops = [{ lineIndex: 0, mine: true }, { lineIndex: 1, mine: false }];
  const myTurn = (): RunState => reduce(reduce(IDLE, { type: "START", stops }), { type: "COUNTDOWN_DONE" });

  function perform(levels: number[], spaceAtMs?: number) {
    let run = myTurn();
    let det = START_DETECTOR;
    levels.forEach((level, i) => {
      if (spaceAtMs === (i + 1) * FRAME_MS) run = reduce(run, { type: "ADVANCE" });
      if (run.phase !== "listening" && run.phase !== "speaking" && run.phase !== "silenceCounting") return;
      const out = detect(det, level, THRESHOLD, SILENCE_LIMIT);
      det = out.state;
      if (out.event) run = reduce(run, { type: toRunEvent[out.event] } as RunEvent);
    });
    return run;
  }

  it("a full line hands the cue to the costar", () => {
    expect(perform([...frames(VOICE, 1000), ...frames(QUIET, 1500)]).phase).toBe("pickupPause");
  });

  it("a short mid-line pause keeps it my turn", () => {
    expect(perform([...frames(VOICE, 1000), ...frames(QUIET, 800)]).phase).toBe("silenceCounting");
  });

  it("the space bar overrides a long dramatic pause before the detector would end it", () => {
    // I speak, then hold a pause, and press Space 500ms into it, well before the 1.2s threshold.
    const run = perform([...frames(VOICE, 1000), ...frames(QUIET, 3000)], 1500);
    expect(run.phase).toBe("pickupPause");
  });

  it("the space bar works even before I've said anything", () => {
    expect(perform(frames(QUIET, 2000), 500).phase).toBe("pickupPause");
  });

  it("never auto-advances while waiting for me", () => {
    const run = perform(frames(QUIET, 20000));
    expect(run).toMatchObject({ phase: "listening", waiting: true });
  });
});
