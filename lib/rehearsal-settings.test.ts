import { describe, expect, it } from "vitest";
import { clampPickup, clampSpeed, parseSettings } from "./rehearsal-settings";

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

describe("parseSettings", () => {
  it("clamps saved values and fills in missing ones", () => {
    expect(parseSettings({ speed: 9, pickup: -2 })).toEqual({ speed: 1.25, pickup: 0 });
    expect(parseSettings({ speed: 0.9 })).toEqual({ speed: 0.9, pickup: 0.3 });
    expect(parseSettings(null)).toEqual({ speed: 1, pickup: 0.3 });
    expect(parseSettings("garbage")).toEqual({ speed: 1, pickup: 0.3 });
  });
});
