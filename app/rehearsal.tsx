"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { cachedKeys, getClip, putClip } from "@/lib/audio-cache";
import { MIC_MESSAGES, MicError, openMic, type Mic, type MicProblem } from "@/lib/mic";
import { startRecorders, type Recorders } from "@/lib/recording";
import { ARM_DELAY_MS, IDLE, MY_TURN, reduce, sceneStops, type RunEvent } from "@/lib/rehearsal-machine";
import {
  clampPickup,
  clampReaderVolume,
  clampSilence,
  clampSpeed,
  parseSettings,
  PICKUP,
  READER_VOLUME,
  SILENCE,
  SPEED,
  type RehearsalSettings,
} from "@/lib/rehearsal-settings";
import { DEMO_CASTING, DEMO_SCENE_NAME, demoClipUrl } from "@/lib/demo";
import type { Script } from "@/lib/script-schema";
import { buildTimingLog, suggestSceneName, takeFilename, type TakeEvent } from "@/lib/take";
import {
  costarAudioJobs,
  defaultCasting,
  linesNeedingAudio,
  type AudioJob,
  type Casting,
} from "@/lib/tts";
import {
  calibrateThreshold,
  detect,
  FRAME_MS,
  SILENT_DB,
  START_DETECTOR,
  startNoiseTracker,
  trackedThreshold,
  trackLevel,
  type DetectorEvent,
  type DetectorState,
  type NoiseTracker,
} from "@/lib/voice-detector";
import { isVoiceId, TTS_MODEL, VOICES } from "@/lib/voices";
import MicMeter from "./mic-meter";
import TakeReview, { type Take } from "./take-review";

// How the detector's findings are passed on to the rehearsal state machine.
const DETECTOR_TO_RUN: Record<DetectorEvent, Exclude<RunEvent["type"], "START">> = {
  speechStart: "SPEECH_START",
  silenceStart: "SILENCE_START",
  speechResume: "SPEECH_RESUME",
  lineEnd: "SILENCE_DONE",
  waiting: "NO_SPEECH_YET",
};

const CAST_KEY = "scene-partner:cast";
const DEMO_CAST_KEY = "scene-partner:demo-cast"; // kept separate so a demo never changes my own choices
type CastChoices = { me: string; casting: Casting };

function loadCast(key: string): CastChoices {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    return { me: typeof raw?.me === "string" ? raw.me : "", casting: raw?.casting ?? {} };
  } catch {
    return { me: "", casting: {} };
  }
}

const SETTINGS_KEY = "scene-partner:rehearsal-settings";

function loadSettings(): RehearsalSettings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"));
  } catch {
    return parseSettings(null);
  }
}

// Fills gaps in saved choices (e.g. after re-parsing a different script) with defaults.
function effectiveCast(saved: CastChoices, characters: string[]): CastChoices {
  const me = characters.includes(saved.me) ? saved.me : (characters[0] ?? "");
  const defaults = defaultCasting(characters, me, VOICES.map((v) => v.id));
  const casting: Casting = {};
  for (const name of Object.keys(defaults)) {
    const chosen = saved.casting[name];
    casting[name] = chosen && isVoiceId(chosen) ? chosen : defaults[name];
  }
  return { me, casting };
}

type Props = {
  script: Script;
  pdfName: string | null; // used to suggest a scene name for the take's file name
  onRehearsingChange: (rehearsing: boolean) => void;
  demo?: boolean; // guest demo mode: fixed voices, bundled audio, no API calls
};

const SCENE_NAME_KEY = "scene-partner:scene-name";
const TAKES_KEY = "scene-partner:take-numbers"; // { "study-room|PRIYA": 2 }

function loadText(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

// The next take number for this scene and role, saved so it survives a refresh.
function nextTakeNumber(scene: string, role: string): number {
  try {
    const all = JSON.parse(localStorage.getItem(TAKES_KEY) ?? "{}");
    const n = (typeof all[`${scene}|${role}`] === "number" ? all[`${scene}|${role}`] : 0) + 1;
    localStorage.setItem(TAKES_KEY, JSON.stringify({ ...all, [`${scene}|${role}`]: n }));
    return n;
  } catch {
    return 1;
  }
}

export default function Rehearsal({ script, pdfName, onRehearsingChange, demo = false }: Props) {
  const castKey = demo ? DEMO_CAST_KEY : CAST_KEY;
  const [saved, setSaved] = useState<CastChoices>(() => loadCast(castKey));
  const cast = effectiveCast(saved, script.characters);
  const me = cast.me;
  // Demo: the voices are fixed, because only those clips were generated.
  const casting: Casting = demo
    ? Object.fromEntries(Object.keys(cast.casting).map((name) => [name, DEMO_CASTING[name]]))
    : cast.casting;

  const [jobs, setJobs] = useState<AudioJob[]>([]);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopGenerating = useRef(false);

  // The rehearsal's turn logic lives in lib/rehearsal-machine.ts; `dispatch` sends it events.
  const [run, dispatch] = useReducer(reduce, IDLE);
  const [countdown, setCountdown] = useState(0); // 3, 2, 1 shown before the scene starts

  const [settings, setSettings] = useState<RehearsalSettings>(loadSettings);
  const speedRef = useRef(settings.speed);
  const silenceRef = useRef(settings.silence);
  const settingsRef = useRef(settings);
  const playing = useRef<HTMLAudioElement | null>(null);

  // Recording a take: the tape's audio mix, the two recorders, and what happened when.
  const handsFreeRun = useRef(false); // is this run listening for my lines?
  const recordingRun = useRef(false); // is this run being recorded?
  const [recordingOn, setRecordingOn] = useState(false); // (for display)
  const [preview, setPreview] = useState<MediaStream | null>(null); // the camera, for the mirrored preview
  const [tapeFormatLabel, setTapeFormatLabel] = useState<string | null>(null);
  const recorders = useRef<Recorders | null>(null);
  const takeEvents = useRef<TakeEvent[]>([]);
  const loggedTurn = useRef(-1);
  const [take, setTake] = useState<Take | null>(null);
  const [sceneName, setSceneName] = useState(() => loadText(SCENE_NAME_KEY));
  const suggestedName = suggestSceneName(pdfName, script.lines);
  const sceneForFile = demo ? DEMO_SCENE_NAME : sceneName.trim() || suggestedName;

  // Hands-free: the open mic, its live level, and the calibrated speech threshold.
  const mic = useRef<Mic | null>(null);
  const [micProblem, setMicProblem] = useState<MicProblem | null>(null);
  const [micOn, setMicOn] = useState(false); // is this run hands-free? (for display)
  const [level, setLevel] = useState(SILENT_DB);
  const [threshold, setThreshold] = useState<number | null>(null);
  const thresholdRef = useRef<number | null>(null); // what the detector uses right now
  const calibrated = useRef(0); // the countdown's measurement; the threshold never drops below it
  const noiseSamples = useRef<number[]>([]); // room noise measured during the countdown
  const noise = useRef<NoiseTracker | null>(null); // follows background noise and my voice
  const countdownStarted = useRef(0);
  const detector = useRef<{ at: number; state: DetectorState } | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  // Save settings, and apply the speed to the clip that's playing right now.
  useEffect(() => {
    speedRef.current = settings.speed;
    silenceRef.current = settings.silence;
    settingsRef.current = settings;
    if (playing.current) {
      playing.current.playbackRate = settings.speed;
      // The reader's playback volume is also how loud they are in the tape.
      playing.current.volume = settings.readerVolume;
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage blocked; settings just won't survive a refresh.
    }
  }, [settings]);

  const generating = progress !== null;
  const rehearsing = run.phase !== "idle" && run.phase !== "sceneEnd";
  const finished = run.phase === "sceneEnd";
  // The line being rehearsed (none during the countdown).
  const position = rehearsing && run.phase !== "countdown" ? run.stops[run.at].lineIndex : null;
  const current = position !== null ? script.lines[position] : null;
  const myTurn = MY_TURN.includes(run.phase);
  const castJson = JSON.stringify(casting);

  // Let the editor know, so it hides the line editor while a scene runs.
  useEffect(() => {
    onRehearsingChange(rehearsing);
  }, [rehearsing, onRehearsingChange]);

  // Save casting choices so a refresh keeps them.
  useEffect(() => {
    try {
      localStorage.setItem(castKey, JSON.stringify({ me, casting: JSON.parse(castJson) }));
    } catch {
      // Storage blocked; choices just won't survive a refresh.
    }
  }, [me, castJson, castKey]);

  // Work out every costar line's cache key, and which of them are already cached.
  useEffect(() => {
    let cancelled = false;
    Promise.all([costarAudioJobs(script, me, JSON.parse(castJson), TTS_MODEL), cachedKeys()])
      .then(([newJobs, keys]) => {
        if (cancelled) return;
        setJobs(newJobs);
        setCached(keys);
      })
      .catch(() => !cancelled && setError("Couldn't open the audio cache in this browser."));
    return () => {
      cancelled = true;
    };
  }, [script, me, castJson]);

  const needed = linesNeedingAudio(jobs, cached);
  const neededChars = needed.reduce((sum, job) => sum + job.chars, 0);
  const jobByLine = useMemo(() => new Map(jobs.map((j) => [j.lineIndex, j])), [jobs]);

  // Demo: copy the bundled clips (public/demo/) into the audio cache instead of generating.
  const neededKeys = needed.map((j) => j.key).join(",");
  useEffect(() => {
    if (!demo || !neededKeys) return;
    let cancelled = false;
    (async () => {
      // All at once, then one update, so each clip is downloaded exactly once.
      const keys = neededKeys.split(",");
      try {
        await Promise.all(
          keys.map(async (key) => {
            const res = await fetch(demoClipUrl(key));
            if (!res.ok) throw new Error(`missing ${key}`);
            await putClip(key, await res.blob());
          }),
        );
      } catch {
        if (!cancelled) setError("The demo voices couldn't be loaded. Check your connection and refresh the page.");
        return;
      }
      if (!cancelled) setCached((prev) => new Set([...prev, ...keys]));
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, neededKeys]);

  async function prepare() {
    setError(null);
    stopGenerating.current = false;
    const todo = needed;
    setProgress({ done: 0, total: todo.length });
    for (const [i, job] of todo.entries()) {
      if (stopGenerating.current) break;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: job.text, voiceId: job.voiceId, parenthetical: job.parenthetical }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(`Stopped at line ${job.lineIndex + 1}: ${data?.error ?? "Something went wrong."}`);
          break;
        }
        await putClip(job.key, await res.blob());
        setCached((prev) => new Set(prev).add(job.key));
        setProgress({ done: i + 1, total: todo.length });
      } catch {
        setError("Couldn't reach the server. Lines generated so far are saved.");
        break;
      }
    }
    setProgress(null);
  }

  async function startRehearsal({ handsFree = settings.handsFree, record = settings.record } = {}) {
    (document.activeElement as HTMLElement | null)?.blur(); // so Space doesn't press a button
    setError(null);
    setMicProblem(null);
    discardTake();
    if (handsFree || record) {
      try {
        mic.current = await openMic({ camera: record }); // the browser asks for permission here
      } catch (err) {
        setMicProblem(err instanceof MicError ? err.problem : "other");
        return;
      }
    }
    handsFreeRun.current = handsFree;
    recordingRun.current = record;
    setMicOn(handsFree);
    setRecordingOn(record);
    setTapeFormatLabel(null);
    setPreview(record && mic.current ? new MediaStream(mic.current.stream.getVideoTracks()) : null);
    takeEvents.current = [];
    loggedTurn.current = -1;
    noiseSamples.current = [];
    noise.current = null;
    thresholdRef.current = null;
    setThreshold(null);
    detector.current = null;
    countdownStarted.current = performance.now();
    setCountdown(3);
    dispatch({ type: "START", stops: sceneStops(script.lines, me) });
  }

  // Mic denied: turn hands-free off and rehearse with the keyboard instead.
  function startWithoutHandsFree() {
    setSettings({ ...settings, handsFree: false });
    void startRehearsal({ handsFree: false, record: false });
  }

  // Camera denied or missing: rehearse without recording.
  function startWithoutRecording() {
    setSettings({ ...settings, record: false });
    void startRehearsal({ record: false });
  }

  function discardTake() {
    setTake((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }

  // My line ended by key press (Space, Page Down, Right Arrow or the Next button).
  function endMyLineByKey() {
    const r = runRef.current;
    if (MY_TURN.includes(r.phase) && r.stops[r.at]) {
      takeEvents.current.push({ t: performance.now(), kind: "myLineEnd", lineIndex: r.stops[r.at].lineIndex, by: "key" });
    }
    dispatch({ type: "ADVANCE" });
  }

  // After the take: build the timing log, name the file, and show it for playback.
  function finishTake(recorded: Awaited<ReturnType<Recorders["stop"]>>, startedAt: Date) {
    const number = nextTakeNumber(sceneForFile, me);
    setTake({
      url: URL.createObjectURL(recorded.tape),
      tape: recorded.tape,
      tapeFormat: recorded.tapeFormat,
      filename: takeFilename(sceneForFile, me, number, startedAt, recorded.tapeFormat.ext),
      number,
      critique: {
        audio: recorded.critique,
        format: recorded.critiqueFormat,
        timing: buildTimingLog(takeEvents.current, startedAt),
      },
    });
  }
  const finishTakeRef = useRef(finishTake);
  useEffect(() => {
    finishTakeRef.current = finishTake;
  });

  const stopRehearsal = () => dispatch({ type: "STOP" });

  // When the scene ends or is stopped: stop the recorders first (so the files are complete),
  // then release the camera and mic. Also if the page closes.
  useEffect(() => {
    if (rehearsing) return;
    const m = mic.current;
    const rec = recorders.current;
    mic.current = null;
    recorders.current = null;
    if (!m) return;
    void (async () => {
      if (rec) {
        takeEvents.current.push({ t: performance.now(), kind: "stop" });
        const startedAt = new Date(Date.now() - (performance.now() - rec.startedAt));
        const recorded = await rec.stop();
        finishTakeRef.current(recorded, startedAt);
      }
      m.close();
    })();
  }, [rehearsing]);
  useEffect(() => () => mic.current?.close(), []);

  // countdown: 3, 2, 1, then the scene starts. Room noise is measured meanwhile.
  useEffect(() => {
    if (run.phase !== "countdown") return;
    const timers = [
      setTimeout(() => setCountdown(2), 1000),
      setTimeout(() => setCountdown(1), 2000),
      setTimeout(async () => {
        if (mic.current && handsFreeRun.current) {
          const t = calibrateThreshold(noiseSamples.current);
          calibrated.current = t;
          thresholdRef.current = t;
          noise.current = startNoiseTracker(noiseSamples.current, t);
          setThreshold(t);
        }
        if (mic.current && recordingRun.current) {
          // Both recorders start together, before the first line plays.
          try {
            const rec = await startRecorders(mic.current);
            if (runRef.current.phase !== "countdown") {
              void rec.stop(); // Stop was pressed while the recorders were starting
              return;
            }
            recorders.current = rec;
            takeEvents.current.push({ t: rec.startedAt, kind: "recordingStart" });
            setTapeFormatLabel(rec.tapeFormat.label);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Recording couldn't start.");
            dispatch({ type: "STOP" });
            return;
          }
        }
        dispatch({ type: "COUNTDOWN_DONE" });
      }, 3000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [run.phase]);

  // Hands-free: check the mic every 50ms. Levels are only used for calibration (during
  // the countdown), tracking background noise (my turn and the pauses before the costar),
  // and detection (my turn, once armed). Never while the costar plays.
  useEffect(() => {
    if (!rehearsing || !mic.current || !handsFreeRun.current) return;
    // Diagnostics (development only): one summary line per second, copied into
    // .next/dev/logs/next-development.log so we can see what the real mic hears.
    const diag = { levels: [] as number[], last: performance.now() };
    if (process.env.NODE_ENV === "development") console.info(`[hands-free] start ${mic.current.describe()}`);
    const tick = setInterval(() => {
      if (!mic.current) return;
      const db = mic.current.level();
      setLevel(db);
      const r = runRef.current;
      if (process.env.NODE_ENV === "development") {
        diag.levels.push(db);
        if (performance.now() - diag.last >= 1000) {
          const sorted = [...diag.levels].sort((a, b) => a - b);
          const n = noise.current;
          const voice = n && n.voice.length ? [...n.voice].sort((a, b) => a - b)[n.voice.length >> 1].toFixed(1) : "-";
          const bg = n && n.smoothed.length ? Math.min(...n.smoothed).toFixed(1) : "-";
          console.info(
            `[hands-free] ${r.phase} line=${r.stops[r.at] ? r.stops[r.at].lineIndex + 1 : "-"} armed=${r.armed} ` +
              `level min/median/max=${sorted[0].toFixed(1)}/${sorted[sorted.length >> 1].toFixed(1)}/${sorted.at(-1)!.toFixed(1)} ` +
              `threshold=${thresholdRef.current?.toFixed(1) ?? "-"} calibrated=${calibrated.current.toFixed(1)} background=${bg} voice=${voice} ` +
              `detector=${detector.current?.state.phase ?? "-"} silenceMs=${detector.current?.state.silenceMs ?? "-"} ${mic.current.describe()}`,
          );
          diag.levels = [];
          diag.last = performance.now();
        }
      }
      if (r.phase === "countdown") {
        // Skip the first second (the click on Start), then collect ~2s of room noise.
        if (performance.now() - countdownStarted.current >= 1000) noiseSamples.current.push(db);
        return;
      }
      const listeningNow = MY_TURN.includes(r.phase) && r.armed;
      if (noise.current && thresholdRef.current !== null && (listeningNow || r.phase === "pickupPause")) {
        noise.current = trackLevel(noise.current, db, calibrated.current);
        const t = trackedThreshold(noise.current, calibrated.current);
        if (Math.abs(t - thresholdRef.current) >= 0.5) setThreshold(t); // move the meter's marker
        thresholdRef.current = t;
      }
      if (!listeningNow || thresholdRef.current === null) {
        detector.current = null; // a fresh detector for each of my turns
        return;
      }
      if (detector.current?.at !== r.at) detector.current = { at: r.at, state: START_DETECTOR };
      const out = detect(detector.current.state, db, thresholdRef.current, silenceRef.current * 1000);
      detector.current.state = out.state;
      if (out.event) {
        if (process.env.NODE_ENV === "development") console.info(`[hands-free] event ${out.event} at ${db.toFixed(1)} dB (threshold ${thresholdRef.current.toFixed(1)})`);
        const lineIndex = r.stops[r.at].lineIndex;
        const t = performance.now();
        if (out.event === "lineEnd") takeEvents.current.push({ t, kind: "myLineEnd", lineIndex, by: "silence" });
        else if (out.event !== "waiting") takeEvents.current.push({ t, kind: out.event, lineIndex });
        dispatch({ type: DETECTOR_TO_RUN[out.event] });
      }
    }, FRAME_MS);
    return () => clearInterval(tick);
  }, [rehearsing]);

  // pickupPause: the beat between my line and the costar's cue.
  useEffect(() => {
    if (run.phase !== "pickupPause") return;
    const timer = setTimeout(() => dispatch({ type: "PICKUP_DONE" }), settings.pickup * 1000);
    return () => clearTimeout(timer);
  }, [run.phase, run.at, settings.pickup]);

  // costarPlaying: load the cached clip and play it; the machine moves on when it ends.
  useEffect(() => {
    if (run.phase !== "costarPlaying" || position === null) return;
    const job = jobByLine.get(position);
    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const clip = job && (await getClip(job.key));
      if (cancelled) return;
      if (!clip) {
        setError(`Line ${position + 1} has no audio yet. Prepare the scene first.`);
        dispatch({ type: "STOP" });
        return;
      }
      url = URL.createObjectURL(clip);
      audio = new Audio(url);
      audio.preservesPitch = true; // faster or slower, but not higher or lower
      audio.playbackRate = speedRef.current;
      audio.volume = settingsRef.current.readerVolume;
      const lineIndex = position;
      const speaker = script.lines[position].speaker ?? "";
      audio.addEventListener("playing", () => takeEvents.current.push({ t: performance.now(), kind: "costarStart", lineIndex, speaker }), { once: true });
      audio.onended = () => {
        takeEvents.current.push({ t: performance.now(), kind: "costarEnd", lineIndex });
        dispatch({ type: "CLIP_ENDED" });
      };
      playing.current = audio;
      audio.play().catch(() => setError("The browser blocked audio playback. Click Start again."));
    })();
    return () => {
      cancelled = true;
      audio?.pause();
      if (playing.current === audio) playing.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [run.phase, position, jobByLine, script.lines]);

  // The start of each of my turns, for the timing log.
  useEffect(() => {
    if (!MY_TURN.includes(run.phase) || loggedTurn.current === run.at) return;
    loggedTurn.current = run.at;
    const stop = run.stops[run.at];
    takeEvents.current.push({ t: performance.now(), kind: "myTurnStart", lineIndex: stop.lineIndex, speaker: me });
  }, [run.phase, run.at, run.stops, me]);

  // listening right after a costar clip: arm the detector 250ms after the clip ends.
  useEffect(() => {
    if (run.phase !== "listening" || run.armed) return;
    const timer = setTimeout(() => dispatch({ type: "ARM" }), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [run.phase, run.armed, run.at]);

  // My turn: Space, Page Down or Right Arrow end my line immediately (a presentation
  // clicker sends Page Down or Right Arrow).
  useEffect(() => {
    if (!myTurn) return;
    function onKey(e: KeyboardEvent) {
      if (!["Space", "PageDown", "ArrowRight"].includes(e.code) || e.repeat) return;
      const target = e.target as HTMLInputElement;
      const typing = target.tagName === "TEXTAREA" || target.tagName === "SELECT" ||
        (target.tagName === "INPUT" && target.type !== "range"); // a focused slider still lets keys continue
      if (typing) return;
      e.preventDefault(); // stop the page from scrolling, or a slider from moving
      endMyLineByKey();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn]);

  // Keep the current line on screen.
  useEffect(() => {
    if (position !== null) {
      document.getElementById(`rehearse-line-${position}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [position]);

  const costars = Object.keys(casting);

  function statusText(): string {
    if (run.phase === "countdown") {
      return micOn ? `Starting in ${countdown}… (stay quiet while the mic measures the room)` : `Starting in ${countdown}…`;
    }
    if (run.phase === "pickupPause") return `${current?.speaker}…`;
    if (run.phase === "costarPlaying") return `${current?.speaker} is speaking…`;
    if (!micOn) return "Your line. Press Space or Next when you're done.";
    if (run.waiting) return "Waiting for you... (Space ends your line)";
    if (run.phase === "listening") return "Your line. Listening…";
    return "Your line. Hearing you… (Space ends your line)";
  }

  return (
    <section className="flex flex-col gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">Rehearse</h2>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          I&apos;m playing
          <select
            value={me}
            disabled={generating || rehearsing}
            onChange={(e) => setSaved({ me: e.target.value, casting })}
            className="rounded border border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700 dark:bg-zinc-900"
          >
            {script.characters.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        {costars.map((name) => (
          <label key={name} className="flex items-center gap-2">
            {name}
            <select
              aria-label={`Voice for ${name}`}
              value={casting[name]}
              disabled={generating || rehearsing || demo}
              onChange={(e) => setSaved({ me, casting: { ...casting, [name]: e.target.value } })}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.description.toLowerCase()})
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {/* Playback only: changing these never regenerates audio or uses credits. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          Costar speed
          <input
            type="range"
            min={SPEED.min}
            max={SPEED.max}
            step={SPEED.step}
            value={settings.speed}
            onChange={(e) => setSettings({ ...settings, speed: clampSpeed(Number(e.target.value)) })}
            className="w-32 accent-black dark:accent-zinc-50"
          />
          <span data-testid="speed-value" className="w-12 tabular-nums">
            {settings.speed.toFixed(2)}×
          </span>
        </label>
        <label className="flex items-center gap-2">
          Cue pickup
          <input
            type="range"
            min={PICKUP.min}
            max={PICKUP.max}
            step={PICKUP.step}
            value={settings.pickup}
            onChange={(e) => setSettings({ ...settings, pickup: clampPickup(Number(e.target.value)) })}
            className="w-32 accent-black dark:accent-zinc-50"
          />
          <span data-testid="pickup-value" className="w-10 tabular-nums">
            {settings.pickup.toFixed(1)}s
          </span>
        </label>
      </div>

      {/* Hands-free: the mic notices when my line ends. Space always works too. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.handsFree}
            disabled={rehearsing}
            onChange={(e) => setSettings({ ...settings, handsFree: e.target.checked })}
            className="accent-black dark:accent-zinc-50"
          />
          Hands-free
        </label>
        <label className={`flex items-center gap-2 ${settings.handsFree ? "" : "opacity-40"}`}>
          Silence threshold
          <input
            type="range"
            min={SILENCE.min}
            max={SILENCE.max}
            step={SILENCE.step}
            value={settings.silence}
            disabled={!settings.handsFree}
            onChange={(e) => setSettings({ ...settings, silence: clampSilence(Number(e.target.value)) })}
            className="w-32 accent-black dark:accent-zinc-50"
          />
          <span data-testid="silence-value" className="w-10 tabular-nums">
            {settings.silence.toFixed(1)}s
          </span>
        </label>
      </div>

      {/* Recording the take. Volumes apply immediately, even mid-scene. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.record}
            disabled={rehearsing}
            onChange={(e) => setSettings({ ...settings, record: e.target.checked })}
            className="accent-black dark:accent-zinc-50"
          />
          Record take
        </label>
        <label className="flex items-center gap-2">
            Reader volume
            <input
              type="range"
              min={READER_VOLUME.min}
              max={READER_VOLUME.max}
              step={READER_VOLUME.step}
              value={settings.readerVolume}
              onChange={(e) => setSettings({ ...settings, readerVolume: clampReaderVolume(Number(e.target.value)) })}
              className="w-32 accent-black dark:accent-zinc-50"
            />
            <span data-testid="reader-volume-value" className="w-10 tabular-nums">
              {Math.round(settings.readerVolume * 100)}%
            </span>
          </label>
        <label className={`flex items-center gap-2 ${settings.record ? "" : "opacity-40"} ${demo ? "hidden" : ""}`}>
          Scene name
          <input
            value={sceneName}
            placeholder={suggestedName}
            disabled={rehearsing}
            onChange={(e) => {
              setSceneName(e.target.value);
              try {
                localStorage.setItem(SCENE_NAME_KEY, e.target.value);
              } catch {
                // Storage blocked; the name just won't survive a refresh.
              }
            }}
            className="w-48 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>

      {!rehearsing && (
        <p data-testid="speakers-tip" className="text-sm text-zinc-600 dark:text-zinc-400">
          Tip: Keep the reader quieter than your voice. Laptop volume around 50%.
        </p>
      )}

      {micProblem && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span data-testid="mic-problem">{MIC_MESSAGES[micProblem]}</span>
          {settings.record ? (
            <button onClick={startWithoutRecording} className="rounded border border-amber-400 px-3 py-1 font-medium">
              Rehearse without recording
            </button>
          ) : (
            <button onClick={startWithoutHandsFree} className="rounded border border-amber-400 px-3 py-1 font-medium">
              Rehearse without hands-free
            </button>
          )}
        </div>
      )}

      {take && !rehearsing && (
        <TakeReview take={take} onRetake={() => void startRehearsal()} onDiscard={discardTake} />
      )}

      {!rehearsing && !take && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p data-testid="audio-summary" className="text-zinc-600 dark:text-zinc-400">
            {jobs.length === 0
              ? "No costar lines to voice."
              : needed.length === 0
                ? `All ${jobs.length} costar lines have audio.`
                : demo
                  ? "Loading the demo voices…"
                  : `${needed.length} of ${jobs.length} costar lines need audio · ${neededChars.toLocaleString()} characters (up to ${neededChars.toLocaleString()} credits)`}
          </p>
          {generating ? (
            <>
              <span className="font-medium">
                Generating {Math.min(progress.done + 1, progress.total)} of {progress.total}…
              </span>
              <button onClick={() => (stopGenerating.current = true)} className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700">
                Stop
              </button>
            </>
          ) : (
            needed.length > 0 && !demo && (
              <button
                onClick={prepare}
                className="rounded bg-black px-4 py-2 font-medium text-white dark:bg-zinc-50 dark:text-black"
              >
                Prepare scene
              </button>
            )
          )}
          <button
            onClick={() => void startRehearsal()}
            disabled={generating || needed.length > 0}
            className="rounded bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-40"
          >
            Start
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {finished && !rehearsing && <p className="text-sm text-emerald-700 dark:text-emerald-400">Scene complete.</p>}

      {rehearsing && (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-white py-2 text-sm dark:bg-black">
            <span className="font-medium" data-testid="run-status" data-phase={run.phase} data-armed={run.armed}>
              {statusText()}
            </span>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                endMyLineByKey();
              }}
              disabled={!myTurn}
              className="ml-auto rounded bg-black px-4 py-1.5 font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-black"
            >
              Next
            </button>
            <button onClick={stopRehearsal} className="rounded border border-red-300 px-4 py-1.5 text-red-600">
              Stop
            </button>
            {micOn && (
              <div className="basis-full">
                <MicMeter level={level} threshold={threshold} active={myTurn && run.armed && threshold !== null} />
              </div>
            )}
          </div>
          {recordingOn && (
            <div className="flex flex-col gap-1">
              {/* Mirrored on screen only (like a mirror); the recording itself is not mirrored. */}
              <video
                ref={(el) => {
                  if (el && el.srcObject !== preview) el.srcObject = preview;
                }}
                autoPlay
                muted
                playsInline
                data-testid="camera-preview"
                className="aspect-video w-full max-w-md -scale-x-100 rounded bg-black"
              />
              <span className="text-xs text-red-600" data-testid="recording-status">
                {tapeFormatLabel ? `● Recording: ${tapeFormatLabel}` : "Camera ready. Recording starts after the countdown."}
              </span>
            </div>
          )}
          <ol className="flex flex-col gap-2">
            {script.lines.map((line, i) => (
              <li
                key={i}
                id={`rehearse-line-${i}`}
                aria-current={i === position ? "step" : undefined}
                className={`rounded p-2 ${
                  i === position
                    ? myTurn
                      ? "bg-amber-100 ring-2 ring-amber-400 dark:bg-amber-900"
                      : "bg-zinc-100 ring-2 ring-zinc-300 dark:bg-zinc-800"
                    : ""
                } ${line.type === "direction" ? "italic text-zinc-500" : ""}`}
              >
                {line.type === "dialogue" && (
                  <div className="text-sm font-semibold">
                    {line.speaker}
                    {line.speaker === me && " (you)"}
                    {line.parenthetical && <span className="font-normal italic"> ({line.parenthetical})</span>}
                  </div>
                )}
                {line.text}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
