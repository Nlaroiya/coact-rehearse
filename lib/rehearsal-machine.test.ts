import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDLE, reduce, sceneStops, transition, type Phase, type RunEvent, type RunState } from "./rehearsal-machine";
import type { Script } from "./script-schema";

const script: Script = JSON.parse(
  readFileSync(new URL("../samples/parse-response.json", import.meta.url), "utf8"),
);
// study-room.txt as PRIYA: MARCUS 3, PRIYA 4, MARCUS 5, PRIYA 7, MARCUS 8, MARCUS 10, PRIYA 12, MARCUS 14, PRIYA 15
const stops = sceneStops(script.lines, "PRIYA");

const run = (events: RunEvent[], from: RunState = IDLE) => events.reduce(reduce, from);
const ev = (type: Exclude<RunEvent["type"], "START">) => ({ type }) as RunEvent;
const start = { type: "START", stops } as RunEvent;
const line = (s: RunState) => script.lines[s.stops[s.at].lineIndex];

describe("sceneStops", () => {
  it("skips directions and marks which lines are mine", () => {
    expect(stops.map((s) => s.lineIndex + 1)).toEqual([3, 4, 5, 7, 8, 10, 12, 14, 15]);
    expect(stops.map((s) => s.mine)).toEqual([false, true, false, true, false, false, true, false, true]);
  });

  it("skips dialogue that's only an action in parentheses", () => {
    const lines = [
      { type: "dialogue", speaker: "BLAIR", text: "(BLAIR takes a photo of a cloud)" },
      { type: "dialogue", speaker: "BLAIR", text: "Very." },
    ];
    expect(sceneStops(lines, "JONAH")).toEqual([{ lineIndex: 1, mine: false }]);
  });
});

describe("rehearsal state machine", () => {
  it("Start → countdown → the first line (a costar's)", () => {
    const s = run([start]);
    expect(s.phase).toBe("countdown");
    const t = run([ev("COUNTDOWN_DONE")], s);
    expect(t.phase).toBe("costarPlaying");
    expect(line(t).speaker).toBe("MARCUS");
  });

  it("after a costar line, my turn starts listening but unarmed until ARM", () => {
    const s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED")]);
    expect(s).toMatchObject({ phase: "listening", armed: false });
    expect(line(s).speaker).toBe("PRIYA");
    // Speech before arming (e.g. the reader's echo) is ignored.
    expect(run([ev("SPEECH_START")], s).phase).toBe("listening");
    const armed = run([ev("ARM")], s);
    expect(armed.armed).toBe(true);
    expect(run([ev("SPEECH_START")], armed).phase).toBe("speaking");
  });

  it("speaking ⇄ silenceCounting, then silence ends the line and the costar's pickup pause begins", () => {
    let s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ARM"), ev("SPEECH_START")]);
    s = run([ev("SILENCE_START")], s);
    expect(s.phase).toBe("silenceCounting");
    s = run([ev("SPEECH_RESUME")], s); // a short pause mid-line
    expect(s.phase).toBe("speaking");
    s = run([ev("SILENCE_START"), ev("SILENCE_DONE")], s);
    expect(s.phase).toBe("pickupPause");
    expect(line(s).speaker).toBe("MARCUS");
    expect(run([ev("PICKUP_DONE")], s).phase).toBe("costarPlaying");
  });

  it("passes through lineDone (the raw transition shows it)", () => {
    const s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ARM"), ev("SPEECH_START"), ev("SILENCE_START")]);
    expect(transition(s, ev("SILENCE_DONE")).phase).toBe("lineDone");
  });

  it.each<Phase>(["listening", "speaking", "silenceCounting"])("the Space override ends my line from %s", (phase) => {
    let s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ARM")]);
    if (phase !== "listening") s = run([ev("SPEECH_START")], s);
    if (phase === "silenceCounting") s = run([ev("SILENCE_START")], s);
    expect(s.phase).toBe(phase);
    expect(transition(s, ev("ADVANCE")).phase).toBe("lineDone");
    expect(run([ev("ADVANCE")], s).phase).toBe("pickupPause");
  });

  it("the override works even before the detector is armed", () => {
    const s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED")]);
    expect(run([ev("ADVANCE")], s).phase).toBe("pickupPause");
  });

  it("Space does nothing while the costar is playing or during the countdown", () => {
    const counting = run([start]);
    expect(run([ev("ADVANCE")], counting)).toEqual(counting);
    const costar = run([start, ev("COUNTDOWN_DONE")]);
    expect(run([ev("ADVANCE")], costar)).toEqual(costar);
  });

  it("two costar lines in a row get a cue-pickup pause between them", () => {
    // ...MARCUS 8 → MARCUS 10
    let s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ADVANCE"), ev("PICKUP_DONE"), ev("CLIP_ENDED"), ev("ADVANCE"), ev("PICKUP_DONE")]);
    expect(s.stops[s.at].lineIndex + 1).toBe(8);
    s = run([ev("CLIP_ENDED")], s);
    expect(s.phase).toBe("pickupPause");
    expect(s.stops[s.at].lineIndex + 1).toBe(10);
    s = run([ev("PICKUP_DONE")], s);
    expect(s.phase).toBe("costarPlaying");
    expect(s.stops[s.at].lineIndex + 1).toBe(10);
  });

  it("my line straight after another of my lines starts listening already armed", () => {
    const mine = [{ lineIndex: 0, mine: true }, { lineIndex: 1, mine: true }];
    const s = run([{ type: "START", stops: mine }, ev("COUNTDOWN_DONE")]);
    expect(s).toMatchObject({ phase: "listening", armed: true }); // a scene can start with my line
    expect(run([ev("ADVANCE")], s)).toMatchObject({ phase: "listening", armed: true, at: 1 });
  });

  it("the whole scene by keyboard reaches sceneEnd", () => {
    let s = run([start, ev("COUNTDOWN_DONE")]);
    const visited: number[] = [];
    for (let guard = 0; s.phase !== "sceneEnd" && guard < 50; guard++) {
      visited.push(s.stops[s.at].lineIndex + 1);
      if (s.phase === "costarPlaying") s = run([ev("CLIP_ENDED")], s);
      else if (s.phase === "pickupPause") { visited.pop(); s = run([ev("PICKUP_DONE")], s); }
      else s = run([ev("ADVANCE")], s);
    }
    expect(visited).toEqual([3, 4, 5, 7, 8, 10, 12, 14, 15]);
    expect(s.phase).toBe("sceneEnd");
  });

  it("'waiting for you' shows but never advances, and clears when I speak", () => {
    let s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ARM"), ev("NO_SPEECH_YET")]);
    expect(s).toMatchObject({ phase: "listening", waiting: true });
    s = run([ev("SPEECH_START")], s);
    expect(s).toMatchObject({ phase: "speaking", waiting: false });
  });

  it("ignores events that don't fit the current state (e.g. a late clip-ended)", () => {
    const s = run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED")]);
    for (const e of ["CLIP_ENDED", "PICKUP_DONE", "SILENCE_DONE", "SPEECH_RESUME", "COUNTDOWN_DONE"] as const) {
      expect(run([ev(e)], s)).toEqual(s);
    }
  });

  it("Stop returns to idle from every state", () => {
    const states = [
      run([start]),
      run([start, ev("COUNTDOWN_DONE")]),
      run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED")]),
      run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ARM"), ev("SPEECH_START")]),
      run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ARM"), ev("SPEECH_START"), ev("SILENCE_START")]),
      run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED"), ev("ADVANCE")]),
      transition(run([start, ev("COUNTDOWN_DONE"), ev("CLIP_ENDED")]), ev("ADVANCE")), // lineDone
      run([{ type: "START", stops: [] }]), // sceneEnd
    ];
    expect(states.map((s) => s.phase)).toEqual(["countdown", "costarPlaying", "listening", "speaking", "silenceCounting", "pickupPause", "lineDone", "sceneEnd"]);
    for (const s of states) expect(transition(s, ev("STOP"))).toEqual(IDLE);
  });

  it("Start again after the scene ends begins a new run", () => {
    const ended = run([{ type: "START", stops: [] }]);
    expect(run([start], ended).phase).toBe("countdown");
  });
});
