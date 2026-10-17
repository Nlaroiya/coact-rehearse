// Browser-only: opens the microphone and reports its level for the voice detector.
import { levelDb } from "./voice-detector";

export type MicProblem = "denied" | "notFound" | "inUse" | "unsupported" | "other";

export class MicError extends Error {
  constructor(public problem: MicProblem) {
    super(problem);
  }
}

export type Mic = {
  stream: MediaStream; // also needed later for recording the self-tape
  level: () => number; // current loudness in dBFS
  close: () => void;
  describe: () => string; // TEMPORARY diagnostics: which mic, and is audio processing running
};

export async function openMic(): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("unsupported");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // All off: the recording needs my real vocal dynamics, not "cleaned up" audio.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("notFound");
    if (name === "NotReadableError") throw new MicError("inUse");
    throw new MicError("other");
  }

  // An AnalyserNode lets us read the raw mic samples; it isn't connected to the
  // speakers, so you never hear yourself.
  const context = new AudioContext();
  await context.resume();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048; // ~43ms of audio at 48kHz: about one 50ms check's worth
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  return {
    stream,
    level: () => {
      analyser.getFloatTimeDomainData(samples);
      return levelDb(samples);
    },
    close: () => {
      stream.getTracks().forEach((t) => t.stop()); // turns off the browser's mic indicator
      void context.close();
    },
    describe: () => {
      const track = stream.getAudioTracks()[0];
      const s = track?.getSettings() ?? {};
      return `mic="${track?.label}" state=${track?.readyState} muted=${track?.muted} audioContext=${context.state} rate=${context.sampleRate} echoCancellation=${s.echoCancellation} noiseSuppression=${s.noiseSuppression} autoGainControl=${s.autoGainControl}`;
    },
  };
}

export const MIC_MESSAGES: Record<MicProblem, string> = {
  denied:
    "Microphone access is blocked. Click the icon at the left of the address bar, allow the microphone, then press Start again.",
  notFound: "No microphone was found. Plug one in, then press Start again.",
  inUse: "Your microphone is being used by another app. Close that app, then press Start again.",
  unsupported: "This browser can't use the microphone here. Try the latest Chrome, Edge or Safari.",
  other: "The microphone couldn't be started. Please try again.",
};
