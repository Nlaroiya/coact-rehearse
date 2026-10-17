// Rehearsal playback settings. These only change how saved clips are played in the
// browser, so they never affect the cache key and never cost ElevenLabs credits.

export const SPEED = { min: 0.75, max: 1.25, step: 0.05, default: 1 } as const;
export const PICKUP = { min: 0, max: 2, step: 0.1, default: 0.3 } as const; // seconds

type Range = { min: number; max: number; step: number; default: number };

// Forces a value into range and snaps it to the nearest step.
// Anything that isn't a finite number (e.g. damaged saved data) becomes the default.
function clamp(value: unknown, range: Range): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return range.default;
  const inRange = Math.min(range.max, Math.max(range.min, value));
  const snapped = range.min + Math.round((inRange - range.min) / range.step) * range.step;
  return Number(snapped.toFixed(2)); // avoid float noise like 1.1500000000000001
}

export const clampSpeed = (value: unknown) => clamp(value, SPEED);
export const clampPickup = (value: unknown) => clamp(value, PICKUP);

export type RehearsalSettings = { speed: number; pickup: number };

// Reads settings from saved JSON, falling back to defaults for anything missing or invalid.
export function parseSettings(raw: unknown): RehearsalSettings {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { speed: clampSpeed(obj.speed), pickup: clampPickup(obj.pickup) };
}
