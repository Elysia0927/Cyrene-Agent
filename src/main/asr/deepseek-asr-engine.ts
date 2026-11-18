import { resolveTimeoutPolicy } from "../runtime-policy";
import { encodePcm16MonoWav } from "./mossland-asr-engine";
import { traceAsr } from "./asr-trace";

const DEEPSEEK_ASR_URL = "https://api.deepseek.com/v1/tools/asr";

async function transcribeWav(apiKey:string,wav:Buffer):Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");

    const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        resolveTimeoutPolicy({ stage: "asr-deepseek" }).totalMs,
      );
      let response: Response;
      try {
        response = await fetch(DEEPSEEK_ASR_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("DeepSeek 转写失败：请求超时，请稍后重试");
        }
        throw new Error(`DeepSeek 转写失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
    
      if (!response.ok) {
        const rawBody = await response.text();
        let detail = rawBody.slice(0, 200);
        try {
          const body = JSON.parse(rawBody) as { error?: { message?: unknown }; message?: unknown };
          const message = body.error?.message ?? body.message;
          if (typeof message === "string" && message.trim()) detail = message.trim();
        } catch {
          // Keep a short response excerpt when the provider does not return JSON.
        }
        throw new Error(`DeepSeek 转写失败：HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
      }
    
      const data = await response.json() as { text?: unknown };
      if (typeof data.text !== "string") {
        throw new Error("DeepSeek 转写失败：服务端未返回 text");
      }
      return data.text.trim();
}

/** DeepSeek 单次转写限制：16000Hz / 16bit / mono。 */
const MAX_PCM_BYTES = 16_000 * 2 * 120;
const MAX_WAV_BYTES = 8 * 1024 * 1024;

/**
 * 把一段完整的 16kHz/16bit/mono PCM 交给 DeepSeek 转写。
 *
 * 通话链路与设置页的文件测试共用这一入口，限制判断只写一遍，
 * 避免两条路径对时长/体积的口径逐渐漂移。
 */
export async function transcribeDeepSeekPcm(apiKey: string, pcm: Buffer): Promise<string> {
  if (!apiKey.trim()) {
    throw new Error("DeepSeek 转写失败：缺少 API Key");
  }
  if (pcm.length === 0) {
    throw new Error("DeepSeek 转写失败：没有可识别的音频数据");
  }
  if (pcm.length > MAX_PCM_BYTES) {
    throw new Error("DeepSeek 转写失败：音频时长超过 120 秒限制");
  }
  const wav = encodePcm16MonoWav(pcm);
  if (wav.length > MAX_WAV_BYTES) {
    throw new Error("DeepSeek 转写失败：音频文件超过 8 MB 限制");
  }
  traceAsr("deepseek.request", { pcmBytes: pcm.length, wavBytes: wav.length, seconds: Number((pcm.length / 2 / 16_000).toFixed(2)) });
  const startedAt = Date.now();
  try {
    const text = await transcribeWav(apiKey, wav);
    traceAsr("deepseek.response", { ms: Date.now() - startedAt, textLen: text.length, preview: text.slice(0, 40) });
    return text;
  } catch (error) {
    traceAsr("deepseek.failed", {
      ms: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export class DeepSeekAsrStream{
    private readonly frames: Buffer[] = [];
      private stopPromise: Promise<string> | null = null;
    
      constructor(
        private readonly apiKey: string,
        private readonly onFinal: (text: string) => void,
      ) {}
    
      async start(): Promise<void> {
        if (!this.apiKey.trim()) {
          throw new Error("DeepSeek 转写失败：缺少 API Key");
        }
      }
    
      sendAudio(pcmFrame: Buffer): void {
        if (this.stopPromise || pcmFrame.length === 0) return;
        this.frames.push(Buffer.from(pcmFrame));
      }
    
      stop(): Promise<string> {
        if (!this.stopPromise) this.stopPromise = this.finish();
        return this.stopPromise;
      }
    
      private async finish(): Promise<string> {
        traceAsr("deepseek.finish", { frames: this.frames.length });
        if (this.frames.length === 0) return "";
        const text = await transcribeDeepSeekPcm(this.apiKey, Buffer.concat(this.frames));
        if (text) this.onFinal(text);
        return text;
    }
}