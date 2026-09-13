// Importing from `@opencode/plugin/tui/plugin` instead of `@opencode/plugin/tui`
// skips the `solid.js` re-export, so this plugin does not drag solid-js into
// the dependency graph when it never renders JSX.
import { define } from "@opencode/plugin/tui/plugin";
import type { Context } from "@opencode/plugin/tui/plugin";
import { unlink } from "node:fs/promises";
import { startRecording, type Recorder } from "./recorder.ts";
import { appendViaClipboard, submitDirect } from "./insert.ts";
import { createMiniMax } from "./providers/minimax.ts";
import { createOpenAICompat } from "./providers/openai-compat.ts";
import { createCore, type ProviderResult } from "./core.ts";

interface PluginOptions {
  readonly provider?: "minimax" | "openai-compat";
  readonly apiKeyEnv?: string;
  readonly language?: string;
  readonly openai?: {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly apiKeyEnv?: string;
  };
}

const LANGUAGES = ["pt", "en", "es", "auto"] as const;
type Language = (typeof LANGUAGES)[number];

interface RecordingState {
  recorder: Recorder | null;
}

export default define({
  id: "opencode-stt",

  async setup(context: Context) {
    const opts = (context.options ?? {}) as PluginOptions;
    const providerId = opts.provider ?? "minimax";
    const apiKeyEnv = opts.apiKeyEnv ?? "MINIMAX_API_KEY";
    const openaiApiKeyEnv = opts.openai?.apiKeyEnv ?? "OPENAI_API_KEY";
    const initialLang: Language =
      opts.language && (LANGUAGES as readonly string[]).includes(opts.language)
        ? (opts.language as Language)
        : "pt";

    const [langStore, mutateLang] = context.storage.store("language", {
      initial: { value: initialLang },
    });
    const [stateStore, mutateState] = context.storage.memory("recording", {
      initial: { recorder: null } as RecordingState,
    });

    const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info", duration = 3000) =>
      context.ui.toast.show({ message, variant, duration });

    const currentLanguage = (): string | undefined => {
      const v = langStore.value as Language;
      return v === "auto" ? undefined : v;
    };

    const getProvider = (): ProviderResult => {
      if (providerId === "minimax") {
        const key = process.env[apiKeyEnv];
        if (!key) return { ok: false, error: `Defina a variável de ambiente ${apiKeyEnv}.` };
        return { ok: true, provider: createMiniMax({ apiKey: key }), language: currentLanguage() };
      }
      if (providerId === "openai-compat") {
        const key = process.env[openaiApiKeyEnv];
        if (!key) return { ok: false, error: `Defina a variável de ambiente ${openaiApiKeyEnv}.` };
        const baseUrl = opts.openai?.baseUrl;
        const model = opts.openai?.model;
        if (!baseUrl || !model) {
          return {
            ok: false,
            error: "openai.baseUrl e openai.model são obrigatórios para provider=openai-compat.",
          };
        }
        return {
          ok: true,
          provider: createOpenAICompat({ baseUrl, model, apiKey: key }),
          // ponytail: most OpenAI-compat servers ignore the language hint,
          // and the openai-compat provider discards it anyway — skip the wire.
          language: undefined,
        };
      }
      return {
        ok: false,
        error: `Provider "${providerId}" desconhecido. Suportados: minimax, openai-compat.`,
      };
    };

    const cleanupFile = async (path: string) => {
      try {
        await unlink(path);
      } catch {
        // file may already be gone; ignore
      }
    };

    const core = createCore({
      startRecording: () => startRecording(),
      getProvider,
      insertAppend: (text) => appendViaClipboard(context, text),
      insertSubmit: (text) => submitDirect(context, text),
      cleanupFile,
      toast,
      persistRecorder: (rec) => {
        mutateState((draft) => {
          draft.recorder = rec;
        });
      },
    });

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "stt.record",
          title: "STT: gravar e inserir",
          description: "Alterna gravação de áudio. Ao parar, transcreve e insere no composer.",
          group: "opencode-stt",
          bind: "ctrl+alt+v",
          palette: true,
          slash: { name: "stt-record" },
          run: () => core.startToggle("append"),
        },
        {
          id: "stt.submit",
          title: "STT: gravar e enviar",
          description: "Alterna gravação de áudio. Ao parar, transcreve e envia o prompt.",
          group: "opencode-stt",
          bind: "<leader>v",
          palette: true,
          slash: { name: "stt-submit" },
          run: () => core.startToggle("submit"),
        },
        {
          id: "stt.stop",
          title: "STT: cancelar gravação",
          description: "Cancela a gravação atual sem transcrever.",
          group: "opencode-stt",
          palette: true,
          slash: { name: "stt-stop" },
          run: () => {
            if (!core.cancel()) {
              toast("Nenhuma gravação ativa.", "info");
              return;
            }
            toast("Gravação cancelada.", "info");
          },
        },
        {
          id: "stt.language",
          title: "STT: escolher idioma",
          description: "Seleciona o idioma de transcrição.",
          group: "opencode-stt",
          palette: true,
          slash: { name: "stt-language" },
          run: async () => {
            const current = langStore.value as Language;
            const picked = await context.ui.dialog.select({
              title: "Idioma de transcrição",
              current,
              options: [
                { value: "pt", title: "pt — português (padrão)" },
                { value: "en", title: "en — inglês" },
                { value: "es", title: "es — espanhol" },
                { value: "auto", title: "auto — multi-idioma" },
              ],
            });
            if (picked) {
              await mutateLang((draft) => {
                draft.value = picked as Language;
              });
              toast(`Idioma: ${picked}`, "success", 1500);
            }
          },
        },
        {
          id: "stt.selftest",
          title: "STT: teste de inserção",
          // ponytail: prompt.paste is void; the success toast only proves the
          // dispatch fired, not that text landed on screen. /stt-selftest
          // requires an open session — on the home route there is no composer.
          description: "Insere um texto fixo via clipboard. Requer sessão aberta; em outras telas (ex.: home) o dispatch de prompt.paste não tem efeito visível.",
          group: "opencode-stt",
          palette: true,
          slash: { name: "stt-selftest" },
          run: async () => {
            try {
              await appendViaClipboard(context, "teste de inserção do opencode-stt");
              toast("Texto de teste inserido.", "success");
            } catch (e) {
              toast(e instanceof Error ? e.message : "Falha no teste.", "error", 5000);
            }
          },
        },
      ],
    }));

    // Reap any ffmpeg process this generation owns, and also any orphan a
    // previous generation left in the shared memory store (hot reload or TUI
    // shutdown). cancel() is a no-op when there is no active recorder.
    return () => {
      core.cancel();
      const orphan = stateStore.recorder;
      if (orphan) {
        mutateState((draft) => {
          draft.recorder = null;
        });
        orphan.cancel();
      }
    };
  },
});
