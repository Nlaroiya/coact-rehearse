// Browser-only: the two recorders for a take.
// The tape's audio is my mic as-is: it picks up the reader from the speakers, like a real
// off-camera reader, so the costar audio is never mixed in digitally (that would double it).
// My mic is never connected to the speakers.
import type { Mic } from "./mic";
import { CRITIQUE_BITS_PER_SECOND, CRITIQUE_FORMATS, pickFormat, TAPE_FORMATS, type RecordingFormat } from "./take";

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
export async function startRecorders(mic: Mic): Promise<Recorders> {
  const tapeFormat = pickFormat(TAPE_FORMATS, isSupported);
  const critiqueFormat = pickFormat(CRITIQUE_FORMATS, isSupported);
  if (!tapeFormat || !critiqueFormat) throw new Error("This browser can't record video. Try the latest Chrome, Edge or Safari.");

  const video = mic.stream.getVideoTracks()[0];
  const audio = mic.stream.getAudioTracks()[0];
  const tape = record(new MediaStream([video, audio]), tapeFormat, { videoBitsPerSecond: 2_500_000 });
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
