import { readFile } from "node:fs/promises";
import { SttError, type SttOptions, type SttProvider, type SttResult } from "./types.ts";

const ENDPOINT = "https://api.minimax.io/v1/speech_to_text";
const TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = "asr-1.0";

export interface MiniMaxOptions {
  readonly apiKey: string;
  readonly model?: string;
}

export function createMiniMax(opts: MiniMaxOptions): SttProvider {
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    id: "minimax",
    async transcribe(wavPath, { language }: SttOptions): Promise<SttResult> {
      const file = new Blob([await readFile(wavPath)], { type: "audio/wav" });
      const form = new FormData();
      form.set("model", model);
      form.set("file", file, "audio.wav");
      form.set("response_format", "json");

      const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}` };
      // ponytail: language is sent as a header per MiniMax spec (multipart body would be ignored).
      if (language) headers["language"] = language;

      const res = await timedFetch(ENDPOINT, { method: "POST", headers, body: form });

      if (res.ok) {
        const data = (await res.json()) as { text?: string; duration?: number };
        return { text: (data.text ?? "").trim(), duration: data.duration };
      }

      const msg = await extractErrorMessage(res, `HTTP ${res.status}`);
      throw new SttError(`http_${res.status}`, msg);
    },
  };
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new SttError("timeout", "Transcrição excedeu o tempo limite");
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new SttError("network", msg);
  } finally {
    clearTimeout(timer);
  }
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}