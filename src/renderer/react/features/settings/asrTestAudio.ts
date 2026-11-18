/**
 * 语音识别测试用的音频预处理。
 *
 * 浏览器侧的 AudioContext 能解码 mp3 / m4a / wav / ogg 等常见格式，
 * Chromium 的解码器比在主进程里手写容器解析可靠得多，所以这里负责
 * 「任意音频文件 → 16kHz / 16bit / mono PCM」，主进程只做转发。
 */

/** DeepSeek 单次转写接受的采样率。 */
export const TARGET_SAMPLE_RATE = 16_000;

/** 单次转写的时长上限，与主进程侧保持一致。 */
export const MAX_DURATION_SEC = 120;

/** 只声明用到的字段，方便在测试里构造替身。 */
export interface AudioBufferLike {
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface DecodedPcm {
  /** 16kHz / 16bit / mono 的裸 PCM。 */
  pcm: Uint8Array;
  /** 以 PCM 长度换算的时长，和真正提交的字节数一致。 */
  durationSec: number;
}

/** 多声道求平均，避免只取左声道时丢掉右声道的语音。 */
export function mixdownToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  const length = Math.min(...channels.map((channel) => channel.length));
  const mixed = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) {
      mixed[i] += channel[i] / channels.length;
    }
  }
  return mixed;
}

/**
 * 线性插值重采样并转成 16bit 定点。
 *
 * 语音识别不需要广播级重采样质量，线性插值足够，而且能在毫秒级处理几分钟音频。
 */
export function resampleToPcm16(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number = TARGET_SAMPLE_RATE,
): Int16Array {
  if (samples.length === 0) return new Int16Array(0);
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new Error("音频采样率无效");
  }
  if (!Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error("目标采样率无效");
  }

  const ratio = sourceRate / targetRate;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    const value = samples[left] * (1 - weight) + samples[right] * weight;
    const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return out;
}

/** 把已解码的 AudioBuffer 转成待提交的 PCM 与时长。 */
export function audioBufferToPcm16k(audio: AudioBufferLike): DecodedPcm {
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    channels.push(audio.getChannelData(channel));
  }

  const pcm16 = resampleToPcm16(mixdownToMono(channels), audio.sampleRate);
  return {
    pcm: new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength),
    durationSec: pcm16.length / TARGET_SAMPLE_RATE,
  };
}

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof AudioContext !== "undefined") return AudioContext as AudioContextCtor;
  // 旧版 Chromium 只暴露 webkit 前缀版本。
  const legacy = (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return legacy ?? null;
}

/**
 * 解码用户选择的音频文件。
 *
 * 超过时长上限时直接抛错，避免把几十兆的 PCM 刷进 IPC 才被主进程拒绝。
 */
export async function decodeAudioFileToPcm(file: File): Promise<DecodedPcm> {
  const AudioContextImpl = resolveAudioContextCtor();
  if (!AudioContextImpl) {
    throw new Error("当前环境无法解码音频");
  }

  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioContextImpl();
  try {
    const decoded = await context.decodeAudioData(arrayBuffer);
    const result = audioBufferToPcm16k(decoded);
    if (result.durationSec > MAX_DURATION_SEC) {
      throw new Error(`音频时长 ${result.durationSec.toFixed(1)} 秒，超过 ${MAX_DURATION_SEC} 秒上限`);
    }
    if (result.pcm.byteLength === 0) {
      throw new Error("音频里没有可识别的内容");
    }
    return result;
  } catch (error) {
    // 解码器抛的是 DOMException，直接冒泡会丢掉可读信息。
    if (error instanceof Error && error.message) throw error;
    throw new Error("无法解码这个音频文件，换一个格式试试");
  } finally {
    void context.close().catch(() => undefined);
  }
}
