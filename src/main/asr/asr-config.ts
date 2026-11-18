export interface AliyunAsrConfig {
  engine: "aliyun";
  appKey: string;
  accessKeyId: string;
  accessKeySecret: string;
  language: string;
}

export interface MosslandAsrConfig {
  engine: "mossland";
  apiKey: string;
}

export interface MiniMaxAsrConfig {
  engine: "minimax";
  apiKey: string;
}

export interface DeepSeekAsrConfig {
  engine: "deepseek";
  apiKey: string;
}

export type AsrConfig = AliyunAsrConfig | MosslandAsrConfig | MiniMaxAsrConfig | DeepSeekAsrConfig;

let asrConfigGetter: (() => AsrConfig | null) | null = null;

export function setAsrConfig(getter: () => AsrConfig | null): void {
  asrConfigGetter = getter;
}

export function getAsrConfig(): AsrConfig | null {
  return asrConfigGetter?.() ?? null;
}
