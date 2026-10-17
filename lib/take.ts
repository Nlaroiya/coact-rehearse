// Pure helpers for recording a take: choosing a format, naming the file, and building the
// line timing log. No browser APIs here, so all of it is testable.

export type RecordingFormat = { mimeType: string; ext: string; label: string };

// Self-tape: MP4 first (what casting sites expect), WebM if the browser can't record MP4.
export const TAPE_FORMATS: RecordingFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.42E01F,mp4a.40.2", ext: "mp4", label: "MP4 (H.264 + AAC)" },
  { mimeType: "video/mp4;codecs=avc1,opus", ext: "mp4", label: "MP4 (H.264 + Opus)" },
  { mimeType: "video/mp4", ext: "mp4", label: "MP4" },
  { mimeType: "video/webm;codecs=vp9,opus", ext: "webm", label: "WebM (VP9 + Opus)" },
  { mimeType: "video/webm;codecs=vp8,opus", ext: "webm", label: "WebM (VP8 + Opus)" },
  { mimeType: "video/webm", ext: "webm", label: "WebM" },
];

// Critique audio: small, and a format Gemini accepts (audio/webm, or audio/m4a).
export const CRITIQUE_FORMATS: RecordingFormat[] = [
  { mimeType: "audio/webm;codecs=opus", ext: "webm", label: "WebM (Opus)" },
  { mimeType: "audio/mp4;codecs=mp4a.40.2", ext: "m4a", label: "M4A (AAC)" },
  { mimeType: "audio/webm", ext: "webm", label: "WebM" },
  { mimeType: "audio/mp4", ext: "m4a", label: "M4A" },
];

export const CRITIQUE_BITS_PER_SECOND = 32_000; // ~4MB per 17 minutes
export const CRITIQUE_WARN_BYTES = 4 * 1024 * 1024;

// The first format this browser can record, or null if none (e.g. no MediaRecorder).
export function pickFormat(
  formats: RecordingFormat[],
  isSupported: (mimeType: string) => boolean,
): RecordingFormat | null {
  return formats.find((f) => isSupported(f.mimeType)) ?? null;
}

// "University Library: Study Room!" → "university-library-study-room"
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // é → e
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

// A default scene name: the PDF's file name, else the first scene heading, else "scene".
export function suggestSceneName(pdfName: string | null, lines: { type: string; text: string }[]): string {
  if (pdfName) {
    const fromPdf = slugify(pdfName.replace(/\.pdf$/i, ""));
    if (fromPdf) return fromPdf;
  }
  const heading = lines.find((l) => l.type === "direction" && /^(INT|EXT|INT\.?\/EXT)\b/i.test(l.text.trim()));
  if (heading) {
    // "INT. UNIVERSITY LIBRARY STUDY ROOM - NIGHT" → "university-library-study-room"
    const place = heading.text.replace(/^(INT\.?\/EXT|INT|EXT)\.?\s*/i, "").replace(/\s+-\s+.*$/, "");
    const slug = slugify(place);
    if (slug) return slug;
  }
  return "scene";
}

// "study-room_PRIYA_take2_2026-10-16.mp4" (the date is the local date of the take).
export function takeFilename(sceneName: string, role: string, take: number, date: Date, ext: string): string {
  const scene = slugify(sceneName) || "scene";
  const who = role.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ME";
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${scene}_${who}_take${take}_${day}.${ext}`;
}

// ---- Line timing log ----

// What the page records while a take runs (t = performance.now() milliseconds).
export type TakeEvent =
  | { t: number; kind: "recordingStart" }
  | { t: number; kind: "costarStart"; lineIndex: number; speaker: string }
  | { t: number; kind: "costarEnd"; lineIndex: number }
  | { t: number; kind: "myTurnStart"; lineIndex: number; speaker: string }
  | { t: number; kind: "speechStart"; lineIndex: number }
  | { t: number; kind: "silenceStart"; lineIndex: number }
  | { t: number; kind: "speechResume"; lineIndex: number }
  | { t: number; kind: "myLineEnd"; lineIndex: number; by: "silence" | "key" }
  | { t: number; kind: "stop" };

export type TimedLine = {
  index: number; // position in script.lines
  speaker: string;
  mine: boolean;
  startMs: number; // costar: clip started playing; mine: my turn began
  speechStartMs: number | null; // mine, hands-free: when I was first heard (≈ when I started speaking)
  endMs: number; // costar: clip ended; mine: when I stopped speaking, or pressed Space
  endedBy: "clip" | "silence" | "key" | "stopped";
};

export type TimingLog = { recordingStartedAt: string; lines: TimedLine[] };

// Turns the raw events into one entry per spoken line, in ms from the recording's start.
export function buildTimingLog(events: TakeEvent[], startedAt: Date): TimingLog {
  const start = events.find((e) => e.kind === "recordingStart");
  if (!start) return { recordingStartedAt: startedAt.toISOString(), lines: [] };
  const rel = (t: number) => Math.max(0, Math.round(t - start.t));
  const lines: TimedLine[] = [];
  let open: (TimedLine & { lastSilence: number | null }) | null = null;

  const close = (endMs: number, endedBy: TimedLine["endedBy"]) => {
    if (!open) return;
    const { lastSilence, ...line } = open;
    // When the detector ended my line, I actually stopped talking when the silence began.
    const end = endedBy === "silence" && lastSilence !== null ? lastSilence : endMs;
    lines.push({ ...line, endMs: Math.max(line.startMs, end), endedBy });
    open = null;
  };

  for (const e of events) {
    if (e.t < start.t) continue;
    switch (e.kind) {
      case "costarStart":
      case "myTurnStart":
        close(rel(e.t), "stopped"); // shouldn't happen, but never lose a line
        open = {
          index: e.lineIndex,
          speaker: e.speaker,
          mine: e.kind === "myTurnStart",
          startMs: rel(e.t),
          speechStartMs: null,
          endMs: rel(e.t),
          endedBy: "stopped",
          lastSilence: null,
        };
        break;
      case "speechStart":
        if (open?.mine && open.index === e.lineIndex && open.speechStartMs === null) open.speechStartMs = rel(e.t);
        break;
      case "silenceStart":
        if (open?.mine && open.index === e.lineIndex) open.lastSilence = rel(e.t);
        break;
      case "speechResume":
        if (open?.mine && open.index === e.lineIndex) open.lastSilence = null;
        break;
      case "costarEnd":
        if (open && !open.mine && open.index === e.lineIndex) close(rel(e.t), "clip");
        break;
      case "myLineEnd":
        if (open?.mine && open.index === e.lineIndex) close(rel(e.t), e.by);
        break;
      case "stop":
        close(rel(e.t), "stopped");
        break;
    }
  }
  return { recordingStartedAt: startedAt.toISOString(), lines };
}
