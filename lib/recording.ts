// Browser-only: the tape's audio mix and the two recorders for a take.
import type { Mic } from "./mic";
import type { AudioMode } from "./rehearsal-settings";
import { CRITIQUE_BITS_PER_SECOND, CRITIQUE_FORMATS, pickFormat, TAPE_FORMATS, type RecordingFormat } from "./take";

// The audio that goes into the self-tape.
//  - Speakers: my mic as-is. It already hears the reader from the speakers, like a real
//    off-camera reader, so nothing is mixed in (that would double the reader).
//  - Headphones: my mic + the costar clips, mixed in one AudioContext. The reader's level in
//    the tape is its own setting and doesn't change what I hear.
// Either way, my mic is never connected to the speakers.
export type TapeMix = {
  audioTrack: MediaStreamTrack;
  routeCostar: (audio: HTMLAudioElement) => void; // call once per clip, before it plays
  setTapeReaderVolume: (volume: number) => void;
  close: () => void;
};

export function createTapeMix(mic: Mic, mode: AudioMode, tapeReaderVolume: number): TapeMix {
  if (mode === "speakers") {
    return {
      audioTrack: mic.stream.getAudioTracks()[0],
      routeCostar: () => {},
      setTapeReaderVolume: () => {},
      close: () => {},
    };
  }
  const { context } = mic;
  const mix = context.createMediaStreamDestination();
  const readerInTape = context.createGain();
  readerInTape.gain.value = tapeReaderVolume;
  readerInTape.connect(mix);
  mic.source.connect(mix);
  return {
    audioTrack: mix.stream.getAudioTracks()[0],
    routeCostar: (audio) => {
      // Once routed, the clip only sounds through these connections: headphones + tape.
      const clip = context.createMediaElementSource(audio);
      clip.connect(context.destination); // what I hear
      clip.connect(readerInTape); // what the tape hears
    },
    setTapeReaderVolume: (volume) => {
      readerInTape.gain.value = volume;
    },
    close: () => {
      mic.source.disconnect(mix);
      readerInTape.disconnect();
    },
  };
}

export type RecordedTake = {
  tape: Blob;
  tapeFormat: RecordingFormat;
  critique: Blob;
  critiqueFormat: RecordingFormat;
};

export type Recorders = {
  startedAt: number; // performance.now() when both recorders had started
  tapeFormat: RecordingFormat;
  stop: () => Promise<RecordedTake>;
};

const isSupported = (t: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t);

function record(stream: MediaStream, format: RecordingFormat, options: MediaRecorderOptions) {
  const recorder = new MediaRecorder(stream, { ...options, mimeType: format.mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const started = new Promise<void>((resolve) => (recorder.onstart = () => resolve()));
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: format.mimeType.split(";")[0] }));
  });
  recorder.start(1000); // save a chunk every second, so a crash mid-take loses little
  return { recorder, started, stopped };
}

// Starts the self-tape and critique recorders together; resolves once both are running.
export async function startRecorders(mic: Mic, tapeAudio: MediaStreamTrack): Promise<Recorders> {
  const tapeFormat = pickFormat(TAPE_FORMATS, isSupported);
  const critiqueFormat = pickFormat(CRITIQUE_FORMATS, isSupported);
  if (!tapeFormat || !critiqueFormat) throw new Error("This browser can't record video. Try the latest Chrome, Edge or Safari.");

  const video = mic.stream.getVideoTracks()[0];
  const tape = record(new MediaStream([video, tapeAudio]), tapeFormat, { videoBitsPerSecond: 2_500_000 });
  const critique = record(new MediaStream(mic.stream.getAudioTracks()), critiqueFormat, {
    audioBitsPerSecond: CRITIQUE_BITS_PER_SECOND,
  });
  // If a recorder never starts (e.g. the mic or camera was unplugged), say so instead of hanging.
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Recording couldn't start. Check your camera and microphone, then press Start again.")), 3000),
  );
  try {
    await Promise.race([Promise.all([tape.started, critique.started]), timeout]);
  } catch (err) {
    for (const r of [tape.recorder, critique.recorder]) if (r.state !== "inactive") r.stop();
    throw err;
  }

  return {
    startedAt: performance.now(),
    tapeFormat,
    stop: async () => {
      for (const r of [tape.recorder, critique.recorder]) if (r.state !== "inactive") r.stop();
      const [tapeBlob, critiqueBlob] = await Promise.all([tape.stopped, critique.stopped]);
      return { tape: tapeBlob, tapeFormat, critique: critiqueBlob, critiqueFormat };
    },
  };
}
