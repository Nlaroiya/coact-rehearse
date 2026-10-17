// A small live mic level bar, with a marker at the calibrated speech threshold.
const FLOOR_DB = -80; // the left edge of the bar

const toPercent = (db: number) => Math.min(100, Math.max(0, ((db - FLOOR_DB) / -FLOOR_DB) * 100));

type Props = { level: number; threshold: number | null; active: boolean };

export default function MicMeter({ level, threshold, active }: Props) {
  const loud = threshold !== null && level >= threshold;
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500" data-testid="mic-meter" data-level={level.toFixed(1)} data-threshold={threshold?.toFixed(1) ?? ""}>
      <span className="w-20">{active ? "Listening" : threshold === null ? "Calibrating" : "Not listening"}</span>
      <div className="relative h-2.5 w-48 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full transition-[width] duration-75 ${!active ? "bg-zinc-400" : loud ? "bg-emerald-500" : "bg-zinc-500"}`}
          style={{ width: `${toPercent(level)}%` }}
        />
        {threshold !== null && (
          <div
            title={`Speech threshold: ${threshold.toFixed(0)} dB`}
            className="absolute top-0 h-full w-0.5 bg-amber-500"
            style={{ left: `${toPercent(threshold)}%` }}
          />
        )}
      </div>
      <span className="w-14 tabular-nums">{level <= -99 ? "silent" : `${level.toFixed(0)} dB`}</span>
    </div>
  );
}
