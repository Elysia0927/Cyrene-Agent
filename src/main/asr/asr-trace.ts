/**
 * ASR 链路的落盘诊断日志。
 *
 * 通话时说话没有反应，可能断在三个位置：渲染端没采到音、主进程没收到帧、
 * 或者转写返回空。这三段都在不同进程里，靠终端输出容易错过，所以统一写到
 * userData/logs/asr-trace.log，一条一行 JSON，方便事后直接读。
 *
 * 只在通话相关事件上写，正常使用不会产生明显噪音。
 */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

let stream: fs.WriteStream | null = null;
let failed = false;

function ensureStream(): fs.WriteStream | null {
  if (stream) return stream;
  if (failed) return null;
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    stream = fs.createWriteStream(path.join(dir, "asr-trace.log"), { flags: "a" });
  } catch {
    failed = true;
    return null;
  }
  return stream;
}

/** 记录一条 ASR 链路事件；任何写入异常都不影响通话本身。 */
export function traceAsr(event: string, data: Record<string, unknown> = {}): void {
  const target = ensureStream();
  if (!target) return;
  try {
    target.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`);
  } catch {
    failed = true;
  }
}
