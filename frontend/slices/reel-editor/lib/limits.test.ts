import { describe, expect, it } from "vitest";
import { assertCompositionBounds, compositionBoundsError, REEL_LIMITS } from "./limits";
import { readBoundedAudioBytes, waveformWithinDecodeBudget } from "./waveform";

function streamResponse(chunks: number[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  }));
}

describe("reel resource limits", () => {
  it("rejects non-finite and oversized canvas/duration values before allocation", () => {
    expect(compositionBoundsError({ w: Infinity, h: 1080, fps: 30, duration: 300 })).toMatch(/finite/);
    expect(compositionBoundsError({ w: REEL_LIMITS.maxCanvasDimension + 1, h: 1, fps: 30, duration: 300 })).toMatch(/dimensions/);
    expect(compositionBoundsError({ w: 4096, h: 4096, fps: 30, duration: 300 })).toBeNull();
    expect(() => assertCompositionBounds({ w: 1920, h: 1080, fps: 30, duration: 30 * 60 * 61 })).toThrow(/one-hour/);
  });

  it("stops a chunked waveform download when the byte cap is crossed", async () => {
    await expect(readBoundedAudioBytes(streamResponse([REEL_LIMITS.maxWaveformBytes, 1])))
      .rejects.toThrow(/byte limit/);
  });

  it("accepts a bounded waveform download and decode shape", async () => {
    await expect(readBoundedAudioBytes(streamResponse([1024, 2048]))).resolves.toHaveProperty("byteLength", 3072);
    expect(waveformWithinDecodeBudget({ duration: 180, numberOfChannels: 2, length: 8_000_000 })).toBe(true);
  });

  it("rejects non-finite, overlong, multichannel and excessive decoded waveforms", () => {
    expect(waveformWithinDecodeBudget({ duration: Infinity, numberOfChannels: 2, length: 1 })).toBe(false);
    expect(waveformWithinDecodeBudget({ duration: REEL_LIMITS.maxWaveformSeconds + 1, numberOfChannels: 2, length: 1 })).toBe(false);
    expect(waveformWithinDecodeBudget({ duration: 10, numberOfChannels: 6, length: 1 })).toBe(false);
    expect(waveformWithinDecodeBudget({ duration: 10, numberOfChannels: 2, length: REEL_LIMITS.maxWaveformSampleValues })).toBe(false);
  });
});
