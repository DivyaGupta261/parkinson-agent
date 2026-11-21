import { describe, expect, it } from "vitest";
import { SILENCE_DB, bandFromCalibration, meterFraction, rms, rmsToDbfs, summariseFrames, zoneOf } from "./loudness";

describe("loudness", () => {
  it("computes RMS", () => {
    expect(rms([0, 0, 0])).toBe(0);
    expect(rms([1, -1, 1, -1])).toBe(1);
    // A full-scale sine wave has RMS 1/√2.
    const sine = Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100));
    expect(rms(sine)).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("converts RMS to dBFS", () => {
    expect(rmsToDbfs(1)).toBe(0);
    expect(rmsToDbfs(0.1)).toBeCloseTo(-20);
    expect(rmsToDbfs(0.5)).toBeCloseTo(-6.02, 1);
    expect(rmsToDbfs(0)).toBe(SILENCE_DB);
  });

  it("classifies levels against a band", () => {
    const band = { low: -30, high: -15 };
    expect(zoneOf(-40, band)).toBe("quiet");
    expect(zoneOf(-20, band)).toBe("target");
    expect(zoneOf(-10, band)).toBe("over");
    expect(meterFraction(-35)).toBeCloseTo(0.5);
    expect(meterFraction(10)).toBe(1);
  });

  it("calibrates a band a little above normal speech", () => {
    expect(bandFromCalibration([-90, -90, -90])).toBeNull();
    const band = bandFromCalibration([-30, -30, -30, -30, -30, -90, -90]);
    expect(band).toEqual({ low: -26, high: -14 });
  });

  it("summarises an exercise", () => {
    const band = { low: -30, high: -15 };
    const frames = [-20, -20, -20, -40, -20, -90]; // 50 ms frames
    const s = summariseFrames(frames, band, 50);
    expect(s.seconds).toBeCloseTo(0.3);
    expect(s.inBandShare).toBeCloseTo(4 / 5);
    expect(s.longestHoldSec).toBeCloseTo(0.15);
    expect(s.meanDb).toBeCloseTo(-24);
  });
});
