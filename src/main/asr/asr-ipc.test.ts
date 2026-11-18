import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IpcScope } from "../application/ipc-scope";

const { transcribeDeepSeekPcm } = vi.hoisted(() => ({ transcribeDeepSeekPcm: vi.fn() }));

vi.mock("./deepseek-asr-engine", () => ({ transcribeDeepSeekPcm }));

import { registerAsrIpc, type AsrTranscribePcmRequest } from "./asr-ipc";

type Handler = (event: unknown, request: AsrTranscribePcmRequest) => Promise<unknown>;

function register(savedKey = "saved-key"): Handler {
  let handler: Handler | undefined;
  const ipc: IpcScope = {
    handle: (_channel, listener) => { handler = listener as Handler; },
    removeHandler: () => {},
    on: () => {},
    dispose: () => {},
  };
  registerAsrIpc({ ipc, getDeepseekKey: () => savedKey });
  if (!handler) throw new Error("ASR IPC handler was not registered");
  return handler;
}

beforeEach(() => {
  transcribeDeepSeekPcm.mockReset();
  transcribeDeepSeekPcm.mockResolvedValue("识别结果");
});

describe("ASR 文件测试 IPC", () => {
  it("把 PCM 转交给 DeepSeek，并优先使用请求里的密钥", async () => {
    const handler = register();
    const pcm = new Uint8Array([1, 2, 3, 4]);

    await expect(handler(null, { engine: "deepseek", apiKey: "typed-key", pcm })).resolves.toBe("识别结果");
    expect(transcribeDeepSeekPcm).toHaveBeenCalledTimes(1);
    const [apiKey, buffer] = transcribeDeepSeekPcm.mock.calls[0] as [string, Buffer];
    expect(apiKey).toBe("typed-key");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(Array.from(buffer)).toEqual([1, 2, 3, 4]);
  });

  it("请求没带密钥时回落到已保存的设置", async () => {
    const handler = register("saved-key");
    await handler(null, { engine: "deepseek", pcm: new Uint8Array([9]) });
    expect(transcribeDeepSeekPcm.mock.calls[0][0]).toBe("saved-key");
  });

  it("没有可用密钥时直接报错，不发起请求", async () => {
    const handler = register("");
    await expect(handler(null, { engine: "deepseek", pcm: new Uint8Array([1]) }))
      .rejects.toThrow("请先填写 DeepSeek API Key");
    expect(transcribeDeepSeekPcm).not.toHaveBeenCalled();
  });

  it("拒绝其他引擎", async () => {
    const handler = register();
    await expect(handler(null, { engine: "mossland", pcm: new Uint8Array([1]) }))
      .rejects.toThrow("当前引擎暂不支持文件测试");
  });

  it("拒绝空音频", async () => {
    const handler = register();
    await expect(handler(null, { engine: "deepseek", pcm: new Uint8Array() }))
      .rejects.toThrow("没有可识别的音频数据");
  });

  it("超过 120 秒的 PCM 在进入引擎前就被拒绝", async () => {
    const handler = register();
    const tooLong = new Uint8Array(16_000 * 2 * 120 + 2);
    await expect(handler(null, { engine: "deepseek", pcm: tooLong }))
      .rejects.toThrow("音频时长超过 120 秒限制");
    expect(transcribeDeepSeekPcm).not.toHaveBeenCalled();
  });
});
