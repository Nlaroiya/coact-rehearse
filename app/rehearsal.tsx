"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cachedKeys, getClip, putClip } from "@/lib/audio-cache";
import {
  clampPickup,
  clampSpeed,
  parseSettings,
  PICKUP,
  SPEED,
  type RehearsalSettings,
} from "@/lib/rehearsal-settings";
import type { Script } from "@/lib/script-schema";
import {
  costarAudioJobs,
  defaultCasting,
  isSpokenLine,
  linesNeedingAudio,
  type AudioJob,
  type Casting,
} from "@/lib/tts";
import { isVoiceId, TTS_MODEL, VOICES } from "@/lib/voices";

const CAST_KEY = "scene-partner:cast";
type CastChoices = { me: string; casting: Casting };

function loadCast(): CastChoices {
  try {
    const raw = JSON.parse(localStorage.getItem(CAST_KEY) ?? "null");
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

type Props = { script: Script; onRehearsingChange: (rehearsing: boolean) => void };

export default function Rehearsal({ script, onRehearsingChange }: Props) {
  const [saved, setSaved] = useState<CastChoices>(loadCast);
  const { me, casting } = effectiveCast(saved, script.characters);

  const [jobs, setJobs] = useState<AudioJob[]>([]);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [position, setPosition] = useState<number | null>(null); // line being rehearsed
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopGenerating = useRef(false);

  const [settings, setSettings] = useState<RehearsalSettings>(loadSettings);
  const [waitingPickup, setWaitingPickup] = useState(false); // pause before a costar's cue
  const speedRef = useRef(settings.speed);
  const pickupDelay = useRef(0); // seconds to wait before the next clip; set after my lines
  const playing = useRef<HTMLAudioElement | null>(null);

  // Save settings, and apply the speed to the clip that's playing right now.
  useEffect(() => {
    speedRef.current = settings.speed;
    if (playing.current) playing.current.playbackRate = settings.speed;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage blocked; settings just won't survive a refresh.
    }
  }, [settings]);

  const generating = progress !== null;
  const rehearsing = position !== null;
  const castJson = JSON.stringify(casting);

  // Save casting choices so a refresh keeps them.
  useEffect(() => {
    try {
      localStorage.setItem(CAST_KEY, JSON.stringify({ me, casting: JSON.parse(castJson) }));
    } catch {
      // Storage blocked; choices just won't survive a refresh.
    }
  }, [me, castJson]);

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

  // Rehearsal only stops on lines someone says; directions (and dialogue that's only
  // an action in parentheses) are shown but skipped.
  const nextStop = (from: number) => {
    const i = script.lines.findIndex((line, idx) => idx >= from && isSpokenLine(line));
    return i === -1 ? null : i;
  };

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

  const current = position !== null ? script.lines[position] : null;
  const myTurn = current?.speaker === me;

  function startRehearsal() {
    (document.activeElement as HTMLElement | null)?.blur(); // so Space doesn't press a button
    setError(null);
    const first = nextStop(0);
    setFinished(first === null);
    if (first === null) return; // no dialogue at all
    setPosition(first);
    onRehearsingChange(true);
  }

  function stopRehearsal() {
    setPosition(null);
    setWaitingPickup(false);
    onRehearsingChange(false);
  }

  function advance() {
    if (position === null) return;
    const next = nextStop(position + 1);
    if (next === null) {
      setFinished(true);
      stopRehearsal();
      return;
    }
    // After one of my lines, give a short beat before the costar picks up the cue.
    if (myTurn && script.lines[next].speaker !== me) {
      pickupDelay.current = settings.pickup;
      setWaitingPickup(settings.pickup > 0);
    }
    setPosition(next);
  }
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  });

  // Costar lines: load the cached clip and play it, then move on when it ends.
  useEffect(() => {
    if (position === null || myTurn) return;
    const job = jobByLine.get(position);
    const delayMs = pickupDelay.current * 1000;
    pickupDelay.current = 0;
    const started = performance.now();
    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    (async () => {
      const clip = job && (await getClip(job.key));
      if (cancelled) return;
      if (!clip) {
        setError(`Line ${position + 1} has no audio yet. Prepare the scene first.`);
        setPosition(null);
        onRehearsingChange(false);
        return;
      }
      url = URL.createObjectURL(clip);
      audio = new Audio(url);
      audio.preservesPitch = true; // faster or slower, but not higher or lower
      audio.playbackRate = speedRef.current;
      audio.onended = () => advanceRef.current();
      // Wait out whatever is left of the cue pickup (loading the clip took part of it).
      timer = setTimeout(() => {
        if (cancelled || !audio) return;
        setWaitingPickup(false);
        playing.current = audio;
        audio.play().catch(() => setError("The browser blocked audio playback. Click Rehearse again."));
      }, Math.max(0, delayMs - (performance.now() - started)));
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      audio?.pause();
      if (playing.current === audio) playing.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [position, myTurn, jobByLine, onRehearsingChange]);

  // My lines: Space (or the Next button) continues.
  useEffect(() => {
    if (!myTurn) return;
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      const target = e.target as HTMLInputElement;
      const typing = target.tagName === "TEXTAREA" || target.tagName === "SELECT" ||
        (target.tagName === "INPUT" && target.type !== "range"); // a focused slider still lets Space continue
      if (typing) return;
      e.preventDefault(); // stop the page from scrolling
      advanceRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, position]);

  // Keep the current line on screen.
  useEffect(() => {
    if (position !== null) {
      document.getElementById(`rehearse-line-${position}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [position]);

  const costars = Object.keys(casting);

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
              disabled={generating || rehearsing}
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

      {!rehearsing && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p data-testid="audio-summary" className="text-zinc-600 dark:text-zinc-400">
            {jobs.length === 0
              ? "No costar lines to voice."
              : needed.length === 0
                ? `All ${jobs.length} costar lines have audio.`
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
            needed.length > 0 && (
              <button
                onClick={prepare}
                className="rounded bg-black px-4 py-2 font-medium text-white dark:bg-zinc-50 dark:text-black"
              >
                Prepare scene
              </button>
            )
          )}
          <button
            onClick={startRehearsal}
            disabled={generating || needed.length > 0}
            className="rounded bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-40"
          >
            Rehearse
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
          <div className="sticky top-0 z-10 flex items-center gap-3 bg-white py-2 text-sm dark:bg-black">
            <span className="font-medium">
              {myTurn
                ? "Your line. Press Space or Next when you're done."
                : waitingPickup
                  ? `${current?.speaker}…`
                  : `${current?.speaker} is speaking…`}
            </span>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                advance();
              }}
              disabled={!myTurn}
              className="ml-auto rounded bg-black px-4 py-1.5 font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-black"
            >
              Next
            </button>
            <button onClick={stopRehearsal} className="rounded border border-red-300 px-4 py-1.5 text-red-600">
              Stop
            </button>
          </div>
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
