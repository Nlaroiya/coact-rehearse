// Browser-only: opens the microphone (and the camera, when recording a take) and reports
// the mic's level for the voice detector.
import { levelDb } from "./voice-detector";

export type MicProblem =
  | "denied"
  | "notFound"
  | "inUse"
  | "cameraDenied"
  | "noCamera"
  | "cameraInUse"
  | "unsupported"
  | "other";

export class MicError extends Error {
  constructor(public problem: MicProblem) {
    super(problem);
  }
}

export type Mic = {
  stream: MediaStream; // the mic track, plus the camera track when recording
  context: AudioContext; // one AudioContext for detection and (in Headphones mode) the tape mix
  source: MediaStreamAudioSourceNode; // the mic inside that AudioContext; never sent to the speakers
  level: () => number; // current loudness in dBFS
  close: () => void;
  describe: () => string; // diagnostics: which mic, and is audio processing running
};

export async function openMic({ camera }: { camera: boolean }): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("unsupported");

  let stream: MediaStream;
  try {
    // One request, so the browser asks for camera and mic permission together.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // All off: the recording needs my real vocal dynamics, not "cleaned up" audio.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: camera ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false,
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicError(camera ? "cameraDenied" : "denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError(camera ? "noCamera" : "notFound");
    if (name === "NotReadableError") throw new MicError(camera ? "cameraInUse" : "inUse");
    throw new MicError("other");
  }

  // An AnalyserNode lets us read the raw mic samples. Nothing here is connected to the
  // speakers, so you never hear yourself.
  const context = new AudioContext();
  await context.resume();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048; // ~43ms of audio at 48kHz: about one 50ms check's worth
  const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  return {
    stream,
    context,
    source,
    level: () => {
      analyser.getFloatTimeDomainData(samples);
      return levelDb(samples);
    },
    close: () => {
      stream.getTracks().forEach((t) => t.stop()); // turns off the browser's mic and camera indicators
      void context.close();
    },
    describe: () => {
      const track = stream.getAudioTracks()[0];
      const s = track?.getSettings() ?? {};
      const video = stream.getVideoTracks()[0]?.getSettings();
      return `mic="${track?.label}" state=${track?.readyState} muted=${track?.muted} audioContext=${context.state} rate=${context.sampleRate} echoCancellation=${s.echoCancellation} noiseSuppression=${s.noiseSuppression} autoGainControl=${s.autoGainControl}${video ? ` camera=${video.width}x${video.height}` : ""}`;
    },
  };
}

const ALLOW = "Click the icon at the left of the address bar, allow";
export const MIC_MESSAGES: Record<MicProblem, string> = {
  denied: `Microphone access is blocked. ${ALLOW} the microphone, then press Start again.`,
  notFound: "No microphone was found. Plug one in, then press Start again.",
  inUse: "Your microphone is being used by another app. Close that app, then press Start again.",
  cameraDenied: `Camera or microphone access is blocked. ${ALLOW} both the camera and the microphone, then press Start again.`,
  noCamera: "No camera (or no microphone) was found. Connect one, then press Start again.",
  cameraInUse: "Your camera or microphone is being used by another app (e.g. Zoom or FaceTime). Close it, then press Start again.",
  unsupported: "This browser can't use the camera or microphone here. Try the latest Chrome, Edge or Safari.",
  other: "The camera or microphone couldn't be started. Please try again.",
};
