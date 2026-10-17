"use client";

import { CRITIQUE_WARN_BYTES, type RecordingFormat, type TimingLog } from "@/lib/take";

export type Take = {
  url: string; // the self-tape, as a temporary in-browser address
  tape: Blob;
  tapeFormat: RecordingFormat;
  filename: string;
  number: number;
  // Kept in memory (never uploaded yet) for the performance notes in Task 5.
  critique: { audio: Blob; format: RecordingFormat; timing: TimingLog };
};

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type Props = { take: Take; onRetake: () => void; onDiscard: () => void };

export default function TakeReview({ take, onRetake, onDiscard }: Props) {
  const tooBig = take.critique.audio.size > CRITIQUE_WARN_BYTES;
  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800" data-testid="take-review">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium">Take {take.number}</h3>
        <span className="text-xs text-zinc-500">
          {take.tapeFormat.label} · {formatSize(take.tape.size)}
        </span>
      </div>
      {/* Not mirrored: this is exactly what casting will see. */}
      <video src={take.url} controls playsInline className="w-full rounded bg-black" data-testid="take-video" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          href={take.url}
          download={take.filename}
          className="rounded bg-black px-4 py-2 font-medium text-white dark:bg-zinc-50 dark:text-black"
        >
          Download
        </a>
        <button onClick={onRetake} className="rounded bg-emerald-600 px-4 py-2 font-medium text-white">
          Retake
        </button>
        <button onClick={onDiscard} className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-700">
          Discard
        </button>
        <span className="text-xs text-zinc-500" data-testid="take-filename">
          {take.filename}
        </span>
      </div>
      <p className={`text-xs ${tooBig ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}`} data-testid="critique-info">
        Audio for performance notes: {formatSize(take.critique.audio.size)} ({take.critique.format.label}),{" "}
        {take.critique.timing.lines.length} lines timed. Kept on this device only.
        {tooBig && " It's over 4 MB, so notes may be slow or fail. Try recording one scene at a time."}
      </p>
      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer">Line timing</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-100 p-2 dark:bg-zinc-900" data-testid="timing-json">
          {JSON.stringify(take.critique.timing, null, 2)}
        </pre>
      </details>
    </div>
  );
}
