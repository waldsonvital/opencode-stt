import { readFile } from "node:fs/promises";
import { SttError, type SttOptions, type SttProvider, type SttResult } from "./types.ts";

const TIMEOUT_MS = 60_000;

export interface OpenAICompatOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export function createOpenAICompat(opts: OpenAICompatOptions): SttProvider {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/audio/transcriptions`;

  return {
    id: "openai-compat",
    async transcribe(wavPath, _opts: SttOptions): Promise<SttResult> {
      const file = new Blob([await readFile(wavPath)]);
      const form = new FormData();
      form.set("model", opts.model);
      form.set("file", file, "audio.wav");

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: form,
          signal: ctrl.signal,
        });
      } catch (e) {
        throw new SttError("network", e instanceof Error ? e.message : String(e));
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        return { text: (data.text ?? "").trim() };
      }

      let msg = `HTTP ${res.status}`;
      try {
        const t = await res.text();
        if (t) msg = t;
      } catch {
        // keep fallback
      }
      throw new SttError(`http_${res.status}`, msg);
    },
  };
}