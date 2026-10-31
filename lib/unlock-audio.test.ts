import { describe, expect, it } from "vitest";
import { silentWavDataUri } from "./unlock-audio";

describe("silentWavDataUri", () => {
  const uri = silentWavDataUri();
  const bytes = Buffer.from(uri.split(",")[1], "base64");

  it("is a WAV data address", () => {
    expect(uri.startsWith("data:audio/wav;base64,")).toBe(true);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WAVE");
  });

  it("has a correct header: PCM, mono, 8kHz, 16-bit, and matching sizes", () => {
    expect(bytes.readUInt16LE(20)).toBe(1);
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt32LE(24)).toBe(8000);
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  });

  it("is silent and tiny (0.05 seconds)", () => {
    expect(bytes.subarray(44).every((b) => b === 0)).toBe(true);
    expect((bytes.length - 44) / 2 / 8000).toBeCloseTo(0.05);
  });
});
