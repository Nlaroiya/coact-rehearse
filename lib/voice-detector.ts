// Hands-free speech detection as pure logic: it's fed one mic level every 50ms and
// says when my line has started and ended. No microphone code here, so it's testable.

export const FRAME_MS = 50; // how often the mic level is checked
export const MIN_SPEECH_MS = 300; // shorter bursts (breaths, clicks) don't count as speech
export const MAX_DIP_MS = 100; // tiny dips between syllables don't break up speech
export const WAITING_AFTER_MS = 10_000; // show "Waiting for you..." after this long with no speech

// Speech threshold = room noise + 10 dB, kept within sensible limits so a silent room
// doesn't make every breath count, and a noisy room doesn't make speech impossible.
export const NOISE_MARGIN_DB = 10;
export const MIN_THRESHOLD_DB = -50;
export const MAX_THRESHOLD_DB = -25;
export const SILENT_DB = -100; // the level reported for pure silence

// Loudness of one slice of mic samples (values from -1 to 1), in dBFS.
export function levelDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(SILENT_DB, 20 * Math.log10(rms)) : SILENT_DB;
}

// Sets the speech threshold from ~2s of room noise measured during the countdown.
// Uses the 90th percentile, so brief quiet moments don't make the room seem quieter than it is.
export function calibrateThreshold(noiseDb: number[]): number {
  if (noiseDb.length === 0) return MIN_THRESHOLD_DB;
  const sorted = [...noiseDb].sort((a, b) => a - b);
  const noise = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.min(MAX_THRESHOLD_DB, Math.max(MIN_THRESHOLD_DB, noise + NOISE_MARGIN_DB));
}

// Background noise can change mid-scene (a sink, a fan), so the threshold follows it.
// The page feeds levels from my turns and the pauses before the costar (never while the
// costar plays), starting with the countdown's room measurement.
const SMOOTH_FRAMES = 250 / FRAME_MS; // average over 250ms, so one quiet frame isn't "a quiet moment"
const BACKGROUND_FRAMES = 3000 / FRAME_MS; // look back 3s for the quietest moment
const MIN_BACKGROUND_FRAMES = 1000 / FRAME_MS; // need 1s of levels before adapting
const VOICE_FRAMES = 200; // remember ~10s of my speech
const MIN_VOICE_FRAMES = 20; // 1s of speech before trusting what my voice sounds like
// A level this far above the countdown's threshold counts as my voice (a sink, which sits
// just around that threshold, doesn't).
const VOICE_ABOVE_THRESHOLD_DB = 6;
export const BELOW_VOICE_DB = 10; // the threshold always stays this far below my voice

export type NoiseTracker = {
  recent: number[]; // the last 250ms of levels
  smoothed: number[]; // 250ms averages over the last 5s
  voice: number[]; // recent levels of my speech
};

// Averages levels as sound power, then converts back to dB (averaging dB directly would
// make loud and quiet moments count equally).
const powerAverage = (levels: number[]) =>
  10 * Math.log10(levels.reduce((sum, l) => sum + 10 ** (l / 10), 0) / levels.length);

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

export function trackLevel(tracker: NoiseTracker, level: number, calibrated: number): NoiseTracker {
  const recent = [...tracker.recent, level].slice(-SMOOTH_FRAMES);
  const smoothed = [...tracker.smoothed, powerAverage(recent)].slice(-BACKGROUND_FRAMES);
  const voice =
    level >= calibrated + VOICE_ABOVE_THRESHOLD_DB ? [...tracker.voice, level].slice(-VOICE_FRAMES) : tracker.voice;
  return { recent, smoothed, voice };
}

// Starts tracking from the levels measured during the countdown.
export function startNoiseTracker(roomLevels: number[], calibrated: number): NoiseTracker {
  const empty: NoiseTracker = { recent: [], smoothed: [], voice: [] };
  return roomLevels.reduce((t, l) => trackLevel(t, l, calibrated), empty);
}

// The threshold right now:
//  - background = the quietest 250ms moment of the last 3s. I usually pause for breath that
//    often, so my own talking rarely raises it; a running sink never goes quiet, so it does.
//  - it never drops below the countdown's measurement,
//  - and never rises above my voice − 10 dB, so speaking normally always registers.
export function trackedThreshold(tracker: NoiseTracker, calibrated: number): number {
  if (tracker.smoothed.length < MIN_BACKGROUND_FRAMES) return calibrated;
  const background = Math.min(...tracker.smoothed);
  let threshold = Math.min(MAX_THRESHOLD_DB, Math.max(calibrated, background + NOISE_MARGIN_DB));
  if (tracker.voice.length >= MIN_VOICE_FRAMES) {
    threshold = Math.max(calibrated, Math.min(threshold, median(tracker.voice) - BELOW_VOICE_DB));
  }
  return threshold;
}

// During a pause, a sound must last this long to count as me talking again, so a
// single clink or drip doesn't restart the silence count.
export const MIN_RESUME_MS = 100;

export type DetectorEvent = "speechStart" | "silenceStart" | "speechResume" | "lineEnd" | "waiting";

export type DetectorState = {
  phase: "beforeSpeech" | "speaking" | "silence" | "done";
  speechMs: number; // beforeSpeech: how long the current burst has lasted
  dipMs: number; // beforeSpeech: how long the current burst has dipped below the threshold
  silenceMs: number; // silence: how long I've been quiet
  resumeMs: number; // silence: how long the current sound has lasted
  sinceStartMs: number; // time since my turn began, for "Waiting for you..."
  waitingSent: boolean;
};

export const START_DETECTOR: DetectorState = {
  phase: "beforeSpeech",
  speechMs: 0,
  dipMs: 0,
  silenceMs: 0,
  resumeMs: 0,
  sinceStartMs: 0,
  waitingSent: false,
};

// One 50ms step. `silenceLimitMs` is the Silence threshold slider.
export function detect(
  state: DetectorState,
  level: number,
  threshold: number,
  silenceLimitMs: number,
): { state: DetectorState; event: DetectorEvent | null } {
  const loud = level >= threshold;
  const s = { ...state };

  switch (s.phase) {
    case "beforeSpeech": {
      s.sinceStartMs += FRAME_MS;
      if (loud) {
        s.speechMs += FRAME_MS;
        s.dipMs = 0;
      } else if (s.speechMs > 0) {
        s.dipMs += FRAME_MS;
        if (s.dipMs > MAX_DIP_MS) {
          s.speechMs = 0; // too short: a breath or a click, not speech
          s.dipMs = 0;
        }
      }
      if (s.speechMs >= MIN_SPEECH_MS) return { state: { ...s, phase: "speaking" }, event: "speechStart" };
      if (s.sinceStartMs >= WAITING_AFTER_MS && !s.waitingSent) {
        return { state: { ...s, waitingSent: true }, event: "waiting" };
      }
      return { state: s, event: null };
    }
    case "speaking":
      if (loud) return { state: s, event: null };
      return { state: { ...s, phase: "silence", silenceMs: FRAME_MS, resumeMs: 0 }, event: "silenceStart" };
    case "silence":
      if (loud) {
        s.resumeMs += FRAME_MS;
        if (s.resumeMs >= MIN_RESUME_MS) {
          return { state: { ...s, phase: "speaking", silenceMs: 0, resumeMs: 0 }, event: "speechResume" };
        }
      } else {
        s.resumeMs = 0;
      }
      s.silenceMs += FRAME_MS; // a brief spike doesn't reset the count
      if (s.silenceMs > silenceLimitMs) return { state: { ...s, phase: "done" }, event: "lineEnd" };
      return { state: s, event: null };
    case "done":
      return { state: s, event: null };
  }
}
