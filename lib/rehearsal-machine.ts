// The rehearsal's turn logic as a pure state machine: no timers, audio or mic here.
// The page sends it events ("clip ended", "speech started", "Space pressed"...) and
// does whatever the new state calls for (play a clip, wait, listen).

import { isSpokenLine } from "./tts";

export type Phase =
  | "idle"
  | "countdown"
  | "costarPlaying"
  | "pickupPause"
  | "listening"
  | "speaking"
  | "silenceCounting"
  | "lineDone"
  | "sceneEnd";

// A line someone actually says. Directions never become stops, so they're skipped.
export type Stop = { lineIndex: number; mine: boolean };

export type RunState = {
  phase: Phase;
  stops: Stop[];
  at: number; // index into stops of the current line
  armed: boolean; // listening: is the detector allowed to hear me yet?
  waiting: boolean; // listening: no speech for a while, show "Waiting for you..."
};

export type RunEvent =
  | { type: "START"; stops: Stop[] }
  | { type: "COUNTDOWN_DONE" }
  | { type: "CLIP_ENDED" }
  | { type: "PICKUP_DONE" }
  | { type: "ARM" } // 250ms after the costar's clip ends
  | { type: "SPEECH_START" }
  | { type: "SILENCE_START" }
  | { type: "SPEECH_RESUME" }
  | { type: "SILENCE_DONE" }
  | { type: "NO_SPEECH_YET" } // 10s without speech
  | { type: "ADVANCE" } // Space, Page Down or Right Arrow
  | { type: "NEXT" } // move on from lineDone
  | { type: "STOP" };

export const IDLE: RunState = { phase: "idle", stops: [], at: 0, armed: false, waiting: false };

// After the costar speaks, wait this long before listening, so the reader's
// echo in the room is never mistaken for me.
export const ARM_DELAY_MS = 250;

// My turn: these are the states where I'm the one meant to be talking.
export const MY_TURN: Phase[] = ["listening", "speaking", "silenceCounting"];

export function sceneStops(
  lines: { type: string; speaker: string | null; text: string }[],
  me: string,
): Stop[] {
  return lines.flatMap((line, lineIndex) =>
    isSpokenLine(line) ? [{ lineIndex, mine: line.speaker === me }] : [],
  );
}

// Enter the stop at index `at`. `afterCostar` means a costar clip just ended.
function enter(state: RunState, at: number, afterCostar: boolean): RunState {
  const stop = state.stops[at];
  if (!stop) return { ...state, phase: "sceneEnd", at, armed: false, waiting: false };
  if (stop.mine) return { ...state, phase: "listening", at, armed: !afterCostar, waiting: false };
  return { ...state, phase: "costarPlaying", at, armed: false, waiting: false };
}

export function transition(state: RunState, event: RunEvent): RunState {
  if (event.type === "STOP") return IDLE;
  const { phase } = state;

  switch (event.type) {
    case "START":
      if (phase !== "idle" && phase !== "sceneEnd") return state;
      return { ...IDLE, phase: event.stops.length ? "countdown" : "sceneEnd", stops: event.stops };
    case "COUNTDOWN_DONE":
      return phase === "countdown" ? enter(state, 0, false) : state;
    case "CLIP_ENDED": {
      if (phase !== "costarPlaying") return state;
      // Two costar lines in a row get the same cue-pickup beat as after my lines.
      const next = state.stops[state.at + 1];
      if (next && !next.mine) return { ...state, phase: "pickupPause", at: state.at + 1 };
      return enter(state, state.at + 1, true);
    }
    case "PICKUP_DONE":
      return phase === "pickupPause" ? { ...state, phase: "costarPlaying" } : state;
    case "ARM":
      return phase === "listening" ? { ...state, armed: true } : state;
    case "SPEECH_START":
      return phase === "listening" && state.armed ? { ...state, phase: "speaking", waiting: false } : state;
    case "NO_SPEECH_YET":
      return phase === "listening" ? { ...state, waiting: true } : state;
    case "SILENCE_START":
      return phase === "speaking" ? { ...state, phase: "silenceCounting" } : state;
    case "SPEECH_RESUME":
      return phase === "silenceCounting" ? { ...state, phase: "speaking" } : state;
    case "SILENCE_DONE":
      return phase === "silenceCounting" ? { ...state, phase: "lineDone" } : state;
    case "ADVANCE":
      // The override: ends my line immediately, whatever the detector thinks.
      return MY_TURN.includes(phase) ? { ...state, phase: "lineDone" } : state;
    case "NEXT": {
      if (phase !== "lineDone") return state;
      const next = state.stops[state.at + 1];
      if (next && !next.mine) return { ...state, phase: "pickupPause", at: state.at + 1, armed: false, waiting: false };
      return enter(state, state.at + 1, false); // my next line, or the end
    }
  }
  return state;
}

// lineDone is a momentary state: the scene moves straight on to what's next.
export function settle(state: RunState): RunState {
  return state.phase === "lineDone" ? transition(state, { type: "NEXT" }) : state;
}

// What the page uses: apply the event, then pass through momentary states.
export const reduce = (state: RunState, event: RunEvent) => settle(transition(state, event));
