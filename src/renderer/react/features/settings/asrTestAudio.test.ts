import { describe, expect, it } from "vitest";
import {
  audioBufferToPcm16k,
  mixdownToMono,
  resampleToPcm16,
  TARGET_SAMPLE_RATE,
} from "./asrTestAudio";

describe("ASR 测试音频预处理", () => {
  it("把 48kHz 双声道降成 16kHz 单声道 16bit", () => {
    const length = 48_000;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const value = Math.sin((2 * Math.PI * 440 * i) / 48_000) * 0.5;
      left[i] = value;
      right[i] = value;
    }

    const decoded = audioBufferToPcm16k({
      numberOfChannels: 2,
      sampleRate: 48_000,
      duration: 1,
      getChannelData: (channel) => (channel === 0 ? left : right),
    });

    // 一秒 16bit 单声道 = 16000 个采样点 = 32000 字节
    expect(decoded.pcm.byteLength).toBe(TARGET_SAMPLE_RATE * 2);
    expect(decoded.durationSec).toBeCloseTo(1, 2);

    const samples = new Int16Array(
      decoded.pcm.buffer,
      decoded.pcm.byteOffset,
      decoded.pcm.byteLength / 2,
    );
    const peak = Array.from(samples).reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    expect(peak).toBeGreaterThan(15_000);
    expect(peak).toBeLessThan(17_000);
  });

  it("多声道取平均，左右相反的信号互相抵消", () => {
    const mixed = mixdownToMono([
      new Float32Array([1, 0.5, -1]),
      new Float32Array([1, -0.5, 1]),
    ]);
    expect(Array.from(mixed)).toEqual([1, 0, 0]);
  });

  it("静音输入得到全零 PCM", () => {
    const pcm = resampleToPcm16(new Float32Array(1024), 44_100);
    expect(pcm.length).toBe(Math.floor(1024 / (44_100 / TARGET_SAMPLE_RATE)));
    expect(Array.from(pcm).every((sample) => sample === 0)).toBe(true);
  });

  it("超范围样本被夹到 16bit 边界", () => {
    const pcm = resampleToPcm16(new Float32Array([2, -2]), 16_000);
    expect(Array.from(pcm)).toEqual([32_767, -32_768]);
  });

  it("拒绝无效采样率", () => {
    expect(() => resampleToPcm16(new Float32Array([0.1]), 0)).toThrow("音频采样率无效");
    expect(() => resampleToPcm16(new Float32Array([0.1]), 16_000, 0)).toThrow("目标采样率无效");
  });
});
