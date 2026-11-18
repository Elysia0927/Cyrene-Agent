import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, AudioLines, FileAudio, Headphones, LoaderCircle, Mic2, X } from "lucide-react";
import { Button } from "antd";
import { siAlibabacloud, siDeepseek, siMinimax } from "simple-icons";
import { BrandIcon } from "../../components/ui/BrandIcon";
import { SettingsInput, SettingsPasswordInput, SettingsSelect, SettingsSlider, SettingsSwitch } from "../../components/ui/SettingsControls";
import { useTranslation } from "../../i18n";
import { Card } from "../../components/ui/Card";
import { decodeAudioFileToPcm } from "./asrTestAudio";

type AsrEngine = "off" | "aliyun" | "mossland" | "minimax" | "deepseek" | "local";
type AsrLanguage = "zh" | "en";
type SecretField = "asrAliyunAppKey" | "asrAliyunAccessKeyId" | "asrAliyunAccessKeySecret" | "ttsMosslandKey" | "asrMinimaxKey" | "asrDeepseekKey";
type AsrValues = {
  asrEngine: AsrEngine;
  asrAliyunAppKey: string;
  asrAliyunAccessKeyId: string;
  asrAliyunAccessKeySecret: string;
  ttsMosslandKey: string;
  asrMinimaxKey: string;
  asrDeepseekKey: string;
  asrLanguage: AsrLanguage;
  asrVadSilenceMs: number;
  asrVadThreshold: number;
  asrShowTranscript: boolean;
};

/** 已解码、等待提交的测试音频。 */
type TestAudio = {
  name: string;
  durationSec: number;
  /** 16kHz / 16bit / mono PCM。 */
  pcm: Uint8Array;
};

const defaults: AsrValues = {
  asrEngine: "off",
  asrAliyunAppKey: "",
  asrAliyunAccessKeyId: "",
  asrAliyunAccessKeySecret: "",
  ttsMosslandKey: "",
  asrMinimaxKey: "",
  asrDeepseekKey: "",
  asrLanguage: "zh",
  asrVadSilenceMs: 1000,
  asrVadThreshold: 0.01,
  asrShowTranscript: false,
};

function readAsrValues(config: Record<string, unknown>): AsrValues {
  return {
    asrEngine: config.asrEngine === "aliyun" || config.asrEngine === "mossland" || config.asrEngine === "minimax" || config.asrEngine === "deepseek" || config.asrEngine === "local" ? config.asrEngine : "off",
    asrAliyunAppKey: typeof config.asrAliyunAppKey === "string" ? config.asrAliyunAppKey : "",
    asrAliyunAccessKeyId: typeof config.asrAliyunAccessKeyId === "string" ? config.asrAliyunAccessKeyId : "",
    asrAliyunAccessKeySecret: typeof config.asrAliyunAccessKeySecret === "string" ? config.asrAliyunAccessKeySecret : "",
    ttsMosslandKey: typeof config.ttsMosslandKey === "string" ? config.ttsMosslandKey : "",
    asrMinimaxKey: typeof config.asrMinimaxKey === "string" ? config.asrMinimaxKey : "",
    asrDeepseekKey: typeof config.asrDeepseekKey === "string" ? config.asrDeepseekKey : "",
    asrLanguage: config.asrLanguage === "en" ? "en" : "zh",
    asrVadSilenceMs: typeof config.asrVadSilenceMs === "number" ? config.asrVadSilenceMs : 1000,
    asrVadThreshold: typeof config.asrVadThreshold === "number" ? config.asrVadThreshold : 0.01,
    asrShowTranscript: config.asrShowTranscript === true,
  };
}

/** Electron 会把主进程异常包成 "Error invoking remote method 'x': Error: y"，这里剥掉外壳。 */
function readErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : "";
  const cleaned = raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "").trim();
  return cleaned || fallback;
}

export function AsrSettingsPanel() {
  const { t } = useTranslation();
  const [values, setValues] = useState<AsrValues>(defaults);
  const [silenceDraft, setSilenceDraft] = useState(String(defaults.asrVadSilenceMs));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testAudio, setTestAudio] = useState<TestAudio | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const secretTimers = useRef<Partial<Record<SecretField, ReturnType<typeof setTimeout>>>>({});
  const pendingSecrets = useRef<Partial<Record<SecretField, string>>>({});
  const testFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (!window.tts) {
      setError(t("settingsPage.asr.unavailable"));
      setLoading(false);
      return;
    }
    void window.tts.loadSettings().then((config) => {
      if (!active) return;
      const nextValues = readAsrValues(config);
      setValues(nextValues);
      setSilenceDraft(String(nextValues.asrVadSilenceMs));
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError(t("settingsPage.asr.loadFailed"));
      setLoading(false);
    });
    return () => { active = false; };
  }, [t]);

  useEffect(() => () => {
    for (const key of Object.keys(secretTimers.current) as SecretField[]) {
      clearTimeout(secretTimers.current[key]);
      const value = pendingSecrets.current[key];
      if (value !== undefined) void window.tts?.saveSettings({ [key]: value }).catch(() => {
        console.warn("[asr] pending setting could not be saved");
      });
    }
  }, []);

  async function persist<K extends keyof AsrValues>(key: K, value: AsrValues[K]) {
    try {
      if (!window.tts) throw new Error("Voice settings API unavailable");
      await window.tts.saveSettings({ [key]: value });
      setError("");
    } catch {
      setError(t("settingsPage.asr.saveFailed"));
    }
  }

  function scheduleSecret(key: SecretField, value: string) {
    clearTimeout(secretTimers.current[key]);
    pendingSecrets.current[key] = value.trim();
    secretTimers.current[key] = setTimeout(() => {
      delete secretTimers.current[key];
      delete pendingSecrets.current[key];
      void persist(key, value.trim());
    }, 800);
  }

  function flushSecret(key: SecretField) {
    const value = pendingSecrets.current[key];
    if (value === undefined) return;
    clearTimeout(secretTimers.current[key]);
    delete secretTimers.current[key];
    delete pendingSecrets.current[key];
    void persist(key, value);
  }

  function update<K extends keyof AsrValues>(key: K, value: AsrValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === "asrAliyunAppKey" || key === "asrAliyunAccessKeyId" || key === "asrAliyunAccessKeySecret" || key === "ttsMosslandKey" || key === "asrMinimaxKey" || key === "asrDeepseekKey") {
      scheduleSecret(key, String(value));
    } else {
      void persist(key, value);
    }
  }

  async function handlePickTestFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 清空 value：同一个文件再选一次也要触发 change。
    event.target.value = "";
    if (!file) return;

    setTestBusy(true);
    setTestError("");
    setTestResult(null);
    try {
      const decoded = await decodeAudioFileToPcm(file);
      setTestAudio({ name: file.name, durationSec: decoded.durationSec, pcm: decoded.pcm });
    } catch (decodeError) {
      setTestAudio(null);
      setTestError(readErrorMessage(decodeError, t("settingsPage.asr.testDecodeFailed")));
    } finally {
      setTestBusy(false);
    }
  }

  async function runTest() {
    if (!testAudio) return;
    setTestBusy(true);
    setTestError("");
    setTestResult(null);
    try {
      if (!window.tts?.transcribeAsr) throw new Error(t("settingsPage.asr.testUnavailable"));
      const text = await window.tts.transcribeAsr({
        engine: "deepseek",
        // 输入框里的密钥可能还没经过防抖落盘，优先用它。
        apiKey: values.asrDeepseekKey.trim() || undefined,
        pcm: testAudio.pcm,
      });
      setTestResult(typeof text === "string" ? text.trim() : "");
    } catch (testFailure) {
      setTestError(readErrorMessage(testFailure, t("settingsPage.asr.testFailed")));
    } finally {
      setTestBusy(false);
    }
  }

  return <div className="cy-asr-page">
    <h1 data-settings-search-loading={loading}>{t("settingsPage.asr.title")}</h1>
    <p className="cy-settings-intro">{t("settingsPage.asr.description")}</p>
    {error && <div className="cy-asr-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span><button type="button" aria-label={t("settingsPage.asr.dismissError")} onClick={() => setError("")}><X size={15} aria-hidden="true" /></button></div>}
    {loading ? <div className="cy-asr-loading" role="status" aria-label={t("settingsPage.asr.loading")}><LoaderCircle size={18} aria-hidden="true" /></div> : <>
      <section className="cy-settings-section">
        <div className="cy-settings-section__heading"><h2 data-settings-search-id="settingsPage.asr.engineTitle"><AudioLines size={18} />{t("settingsPage.asr.engineTitle")}</h2><p>{t("settingsPage.asr.engineDescription")}</p></div>
        <div className="cy-asr-engine-grid" role="group" aria-label={t("settingsPage.asr.engineLabel")}>
          {([
            { value: "off", label: t("settingsPage.asr.engineOff"), icon: <AudioLines size={19} /> },
            { value: "aliyun", label: t("settingsPage.asr.engineAliyun"), icon: <BrandIcon icon={siAlibabacloud} size={20} label="Alibaba Cloud" /> },
            { value: "mossland", label: t("settingsPage.asr.engineMossland"), icon: <Mic2 size={19} /> },
            { value: "minimax", label: t("settingsPage.asr.engineMinimax"), icon: <BrandIcon icon={siMinimax} size={20} label="MiniMax" /> },
            { value: "deepseek", label: t("settingsPage.asr.engineDeepseek"), icon: <BrandIcon icon={siDeepseek} size={20} label="DeepSeek" /> },
            { value: "local", label: t("settingsPage.asr.engineLocal"), icon: <Headphones size={19} /> },
          ] as const).map((engine) => <button key={engine.value} type="button" aria-pressed={values.asrEngine === engine.value} className={`cy-asr-engine ${values.asrEngine === engine.value ? "is-active" : ""}`} onClick={() => update("asrEngine", engine.value)}>
            <span className="cy-asr-engine__icon">{engine.icon}</span><span>{engine.label}</span>
          </button>)}
        </div>
      </section>

      {values.asrEngine === "aliyun" && <section className="cy-settings-section">
        <div className="cy-settings-section__heading"><h2 data-settings-search-id="settingsPage.asr.aliyunTitle"><BrandIcon icon={siAlibabacloud} size={18} label="Alibaba Cloud" />{t("settingsPage.asr.aliyunTitle")}</h2><p>{t("settingsPage.asr.aliyunHint")}</p></div>
        <Card className="cy-asr-fields">
          <label><span>{t("settingsPage.asr.appKey")}</span><SettingsInput value={values.asrAliyunAppKey} onChange={(event) => update("asrAliyunAppKey", event.target.value)} onBlur={() => flushSecret("asrAliyunAppKey")} autoComplete="off" /></label>
          <label><span>{t("settingsPage.asr.accessKeyId")}</span><SettingsInput value={values.asrAliyunAccessKeyId} onChange={(event) => update("asrAliyunAccessKeyId", event.target.value)} onBlur={() => flushSecret("asrAliyunAccessKeyId")} autoComplete="off" /></label>
          <label><span>{t("settingsPage.asr.accessKeySecret")}</span><SettingsPasswordInput showLabel={t("settingsPage.asr.showSecret")} hideLabel={t("settingsPage.asr.hideSecret")} value={values.asrAliyunAccessKeySecret} onChange={(event) => update("asrAliyunAccessKeySecret", event.target.value)} onBlur={() => flushSecret("asrAliyunAccessKeySecret")} autoComplete="off" /></label>
          <label><span>{t("settingsPage.asr.language")}</span><SettingsSelect ariaLabel={t("settingsPage.asr.language")} value={values.asrLanguage} options={[{ value: "zh", label: t("settingsPage.asr.chinese") }, { value: "en", label: t("settingsPage.asr.english") }]} onChange={(value) => update("asrLanguage", value)} /></label>
        </Card>
      </section>}

      {values.asrEngine === "mossland" && <section className="cy-settings-section">
        <div className="cy-settings-section__heading"><h2 data-settings-search-id="settingsPage.asr.mosslandTitle"><Mic2 size={18} />{t("settingsPage.asr.mosslandTitle")}</h2><p>{t("settingsPage.asr.mosslandHint")}</p></div>
        <Card className="cy-asr-fields"><label><span>{t("settingsPage.asr.mosslandKey")}</span><SettingsPasswordInput showLabel={t("settingsPage.asr.showSecret")} hideLabel={t("settingsPage.asr.hideSecret")} value={values.ttsMosslandKey} onChange={(event) => update("ttsMosslandKey", event.target.value)} onBlur={() => flushSecret("ttsMosslandKey")} autoComplete="off" /></label></Card>
      </section>}

      {values.asrEngine === "minimax" && <section className="cy-settings-section">
        <div className="cy-settings-section__heading"><h2 data-settings-search-id="settingsPage.asr.minimaxTitle"><Mic2 size={18} />{t("settingsPage.asr.minimaxTitle")}</h2><p>{t("settingsPage.asr.minimaxHint")}</p></div>
        <Card className="cy-asr-fields"><label><span>{t("settingsPage.asr.minimaxKey")}</span><SettingsPasswordInput showLabel={t("settingsPage.asr.showSecret")} hideLabel={t("settingsPage.asr.hideSecret")} value={values.asrMinimaxKey} onChange={(event) => update("asrMinimaxKey", event.target.value)} onBlur={() => flushSecret("asrMinimaxKey")} autoComplete="off" /></label></Card>
      </section>}

      {values.asrEngine === "deepseek" && <section className="cy-settings-section">
        <div className="cy-settings-section__heading"><h2 data-settings-search-id="settingsPage.asr.deepseekTitle"><BrandIcon icon={siDeepseek} size={18} label="DeepSeek" />{t("settingsPage.asr.deepseekTitle")}</h2><p>{t("settingsPage.asr.deepseekHint")}</p></div>
        <Card className="cy-asr-fields"><label><span>{t("settingsPage.asr.deepseekKey")}</span><SettingsPasswordInput showLabel={t("settingsPage.asr.showSecret")} hideLabel={t("settingsPage.asr.hideSecret")} value={values.asrDeepseekKey} onChange={(event) => update("asrDeepseekKey", event.target.value)} onBlur={() => flushSecret("asrDeepseekKey")} autoComplete="off" /></label></Card>
      </section>}

      {values.asrEngine === "deepseek" && <section className="cy-settings-section">
        <div className="cy-settings-section__heading"><h2 data-settings-search-id="settingsPage.asr.testTitle"><FileAudio size={18} />{t("settingsPage.asr.testTitle")}</h2><p>{t("settingsPage.asr.testHint")}</p></div>
        <Card className="cy-asr-test">
          <div className="cy-asr-test__row">
            <div className="cy-asr-test__copy">
              <strong>{t("settingsPage.asr.testFile")}</strong>
              <span>{testAudio ? `${testAudio.name} · ${testAudio.durationSec.toFixed(1)}s` : t("settingsPage.asr.testNoFile")}</span>
            </div>
            <div className="cy-asr-test__actions">
              <input ref={testFileInput} className="cy-asr-test__input" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" aria-label={t("settingsPage.asr.testChoose")} onChange={(event) => void handlePickTestFile(event)} />
              <Button icon={<FileAudio size={15} />} disabled={testBusy} onClick={() => testFileInput.current?.click()}>{t("settingsPage.asr.testChoose")}</Button>
              <Button type="primary" loading={testBusy} disabled={!testAudio || testBusy} onClick={() => void runTest()}>{t("settingsPage.asr.testRun")}</Button>
            </div>
          </div>
          {testError && <div className="cy-asr-test__error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{testError}</span></div>}
          {testResult !== null && <div className="cy-asr-test__result">
            <strong>{t("settingsPage.asr.testResult")}</strong>
            <p>{testResult || t("settingsPage.asr.testEmptyResult")}</p>
          </div>}
        </Card>
      </section>}

      <section className="cy-settings-section">
        <div className="cy-settings-section__heading"><h2 data-settings-search-id="settingsPage.asr.callTitle"><Headphones size={18} />{t("settingsPage.asr.callTitle")}</h2><p>{t("settingsPage.asr.callDescription")}</p></div>
        <Card>
          <div className="cy-settings-row"><div className="cy-settings-row__copy"><strong data-settings-search-id="settingsPage.asr.vadSilence">{t("settingsPage.asr.vadSilence")}</strong><span>{t("settingsPage.asr.vadSilenceHint")}</span></div><div className="cy-asr-number-control"><SettingsInput className="cy-asr-number-input" type="number" min={300} max={10000} step={100} value={silenceDraft} aria-label={t("settingsPage.asr.vadSilence")} onChange={(event) => { const raw = event.target.value; const parsed = Number(raw); setSilenceDraft(raw); if (raw !== "" && Number.isFinite(parsed) && parsed >= 300 && parsed <= 10000 && parsed !== values.asrVadSilenceMs) update("asrVadSilenceMs", parsed); }} onBlur={() => { const parsed = Number(silenceDraft); const normalized = Math.min(10000, Math.max(300, Number.isFinite(parsed) && parsed > 0 ? parsed : 1000)); setSilenceDraft(String(normalized)); if (normalized !== values.asrVadSilenceMs) update("asrVadSilenceMs", normalized); }} /><span>ms</span></div></div>
          <div className="cy-settings-row"><div className="cy-settings-row__copy"><strong data-settings-search-id="settingsPage.asr.vadThreshold">{t("settingsPage.asr.vadThreshold")}</strong><span>{t("settingsPage.asr.vadThresholdHint")}</span></div><div className="cy-settings-row__control cy-settings-slider"><SettingsSlider min={0.001} max={0.5} step={0.001} value={values.asrVadThreshold} ariaLabel={t("settingsPage.asr.vadThreshold")} onChange={(value) => update("asrVadThreshold", value)} /><span>{values.asrVadThreshold.toFixed(3)}</span></div></div>
          <div className="cy-settings-row"><div className="cy-settings-row__copy"><strong data-settings-search-id="settingsPage.asr.showTranscript">{t("settingsPage.asr.showTranscript")}</strong><span>{t("settingsPage.asr.showTranscriptHint")}</span></div><SettingsSwitch checked={values.asrShowTranscript} ariaLabel={t("settingsPage.asr.showTranscript")} onChange={(value) => update("asrShowTranscript", value)} /></div>
        </Card>
      </section>
    </>}
  </div>;
}
