import { describe, expect, it } from "vitest";
import { clampPickup, clampReaderVolume, clampSilence, clampSpeed, clampTapeReaderVolume, parseSettings } from "./rehearsal-settings";

describe("clampSpeed", () => {
  it("keeps values inside 0.75–1.25", () => {
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(0.75)).toBe(0.75);
    expect(clampSpeed(1.25)).toBe(1.25);
    expect(clampSpeed(1.1)).toBe(1.1);
  });

  it("pulls values outside the range to the nearest limit", () => {
    expect(clampSpeed(0.5)).toBe(0.75);
    expect(clampSpeed(-3)).toBe(0.75);
    expect(clampSpeed(2)).toBe(1.25);
  });

  it("snaps to 0.05 steps", () => {
    expect(clampSpeed(1.12)).toBe(1.1);
    expect(clampSpeed(1.13)).toBe(1.15);
    expect(clampSpeed(0.76)).toBe(0.75);
  });

  it("uses the default (1.0) for anything that isn't a number", () => {
    for (const bad of [NaN, Infinity, "1.1", null, undefined, {}]) expect(clampSpeed(bad)).toBe(1);
  });
});

describe("clampPickup", () => {
  it("keeps values inside 0–2 seconds", () => {
    expect(clampPickup(0)).toBe(0);
    expect(clampPickup(0.3)).toBe(0.3);
    expect(clampPickup(2)).toBe(2);
  });

  it("pulls values outside the range to the nearest limit", () => {
    expect(clampPickup(-1)).toBe(0);
    expect(clampPickup(5)).toBe(2);
  });

  it("snaps to 0.1 steps", () => {
    expect(clampPickup(0.34)).toBe(0.3);
    expect(clampPickup(1.26)).toBe(1.3);
  });

  it("uses the default (0.3s) for anything that isn't a number", () => {
    for (const bad of [NaN, -Infinity, "2", null, undefined, []]) expect(clampPickup(bad)).toBe(0.3);
  });
});

describe("clampSilence", () => {
  it("keeps values inside 0.6–3.0 seconds", () => {
    expect(clampSilence(0.6)).toBe(0.6);
    expect(clampSilence(1.2)).toBe(1.2);
    expect(clampSilence(3)).toBe(3);
  });

  it("pulls values outside the range to the nearest limit", () => {
    expect(clampSilence(0)).toBe(0.6);
    expect(clampSilence(10)).toBe(3);
  });

  it("snaps to 0.1 steps", () => {
    expect(clampSilence(1.24)).toBe(1.2);
    expect(clampSilence(0.66)).toBe(0.7);
  });

  it("uses the default (1.2s) for anything that isn't a number", () => {
    for (const bad of [NaN, "1", null, undefined]) expect(clampSilence(bad)).toBe(1.2);
  });
});

describe("reader volumes", () => {
  it("Reader volume (Speakers): 30–100%, default 60%, 5% steps", () => {
    expect(clampReaderVolume(0.6)).toBe(0.6);
    expect(clampReaderVolume(0.1)).toBe(0.3);
    expect(clampReaderVolume(1.5)).toBe(1);
    expect(clampReaderVolume(0.62)).toBe(0.6);
    expect(clampReaderVolume("loud")).toBe(0.6);
  });

  it("Reader volume in tape (Headphones): 40–100%, default 70%, 5% steps", () => {
    expect(clampTapeReaderVolume(0.7)).toBe(0.7);
    expect(clampTapeReaderVolume(0.2)).toBe(0.4);
    expect(clampTapeReaderVolume(2)).toBe(1);
    expect(clampTapeReaderVolume(0.83)).toBe(0.85);
    expect(clampTapeReaderVolume(undefined)).toBe(0.7);
  });
});

const DEFAULTS = { speed: 1, pickup: 0.3, silence: 1.2, audioMode: "speakers", handsFree: true, record: true, readerVolume: 0.6, tapeReaderVolume: 0.7 };

describe("parseSettings", () => {
  it("clamps saved values and fills in missing ones", () => {
    expect(parseSettings({ speed: 9, pickup: -2, silence: 99 })).toEqual({ ...DEFAULTS, speed: 1.25, pickup: 0, silence: 3 });
    expect(parseSettings({ speed: 0.9 })).toEqual({ ...DEFAULTS, speed: 0.9 });
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings("garbage")).toEqual(DEFAULTS);
  });

  it("defaults to Speakers mode and hands-free on, and rejects unknown values", () => {
    expect(parseSettings({ audioMode: "headphones", handsFree: false })).toMatchObject({ audioMode: "headphones", handsFree: false });
    expect(parseSettings({ audioMode: "radio", handsFree: "yes" })).toMatchObject({ audioMode: "speakers", handsFree: true });
    expect(parseSettings({ record: false })).toMatchObject({ record: false });
    expect(parseSettings({ record: "no" })).toMatchObject({ record: true });
  });
});
