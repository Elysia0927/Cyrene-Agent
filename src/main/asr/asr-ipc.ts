/**
 * ASR 设置页的测试入口。
 *
 * 渲染端已经把音频解码并重采样成 16kHz/16bit/mono，这里只做参数校验与转发，
 * 不碰音频格式解析——浏览器侧的 AudioContext 能覆盖的格式比主进程手写解析多得多。
 */

import { IPC } from "../../shared/ipc-channels";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import { transcribeDeepSeekPcm } from "./deepseek-asr-engine";

/** 与 deepseek-asr-engine 的 120 秒上限保持一致。 */
const MAX_PCM_BYTES = 16_000 * 2 * 120;

export interface AsrTranscribePcmRequest {
  /** 目标引擎；目前只有 deepseek 支持整段文件转写。 */
  engine: string;
  /** 调用方输入框里的密钥，优先于已保存设置。 */
  apiKey?: string;
  /** 16kHz / 16bit / mono 的裸 PCM。 */
  pcm: Uint8Array | ArrayBuffer;
}

export interface RegisterAsrIpcDeps {
  /** 传入共享 scope 以便退出时统一注销；缺省时使用独立 scope。 */
  ipc?: IpcScope;
  /** 读取已保存的 DeepSeek 密钥，供调用方没传 apiKey 时兜底。 */
  getDeepseekKey: () => string;
}

function toPcmBuffer(pcm: AsrTranscribePcmRequest["pcm"] | undefined): Buffer | null {
  if (pcm instanceof ArrayBuffer) return Buffer.from(new Uint8Array(pcm));
  if (pcm instanceof Uint8Array) return Buffer.from(pcm);
  return null;
}

export function registerAsrIpc(deps: RegisterAsrIpcDeps): void {
  const ipc = deps.ipc ?? createIpcScope();

  ipc.handle(IPC.ASR_TRANSCRIBE_PCM, async (_event, request: AsrTranscribePcmRequest) => {
    if (request?.engine !== "deepseek") {
      throw new Error("当前引擎暂不支持文件测试");
    }

    const pcm = toPcmBuffer(request.pcm);
    if (!pcm || pcm.length === 0) {
      throw new Error("没有可识别的音频数据");
    }
    if (pcm.length > MAX_PCM_BYTES) {
      throw new Error("音频时长超过 120 秒限制，请截短后再试");
    }

    const apiKey = (request.apiKey ?? "").trim() || deps.getDeepseekKey().trim();
    if (!apiKey) {
      throw new Error("请先填写 DeepSeek API Key");
    }

    return await transcribeDeepSeekPcm(apiKey, pcm);
  });
}
