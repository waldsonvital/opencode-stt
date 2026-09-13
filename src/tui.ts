// Importing from `@opencode/plugin/tui/plugin` instead of `@opencode/plugin/tui`
// keeps `define` without the host's solid re-export; JSX lives in status.tsx.
import { define } from "@opencode/plugin/tui/plugin";
import type { Context } from "@opencode/plugin/tui/plugin";
import { unlink } from "node:fs/promises";
import { startRecording, type Recorder } from "./recorder.ts";
import { appendViaClipboard, submitDirect } from "./insert.ts";
import { createMiniMax } from "./providers/minimax.ts";
import { createOpenAICompat } from "./providers/openai-compat.ts";
import { createCore, type ProviderResult, type SttPhase } from "./core.ts";
import { renderAsrStatus } from "./status.tsx";
import {
  configFromPreset,
  readSecretsSync,
  resolveRuntime,
  seedFromOptions,
  writeSecret,
  type PluginOptions,
  type PresetId,
  type ProviderConfig,
} from "./config.ts";

const LANGUAGES = ["pt", "en", "es", "auto"] as const;
type Language = (typeof LANGUAGES)[number];

interface RecordingState {
  recorder: Recorder | null;
}

interface StatusState {
  phase: SttPhase;
  spin: number;
}

const SUCCESS_MS = 2500;

type Dialog = Context["ui"]["dialog"];

async function promptCustomProvider(dialog: Dialog): Promise<ProviderConfig | undefined> {
  const baseUrl = await dialog.prompt({
    title: "Base URL",
    description: "Sem barra final e sem /audio/transcriptions. Ex.: http://localhost:1234/v1",
    placeholder: "https://api.openai.com/v1",
  });
  if (baseUrl === undefined) return;
  const model = await dialog.prompt({
    title: "Modelo",
    placeholder: "whisper-1",
  });
  if (model === undefined) return;
  const envName = await dialog.prompt({
    title: "Nome da variável de ambiente da API key",
    value: "OPENAI_API_KEY",
  });
  if (envName === undefined) return;
  const trimmedUrl = baseUrl.trim().replace(/\/$/, "");
  const trimmedModel = model.trim();
  if (!trimmedUrl || !trimmedModel) return;
  return {
    presetId: "other",
    provider: "openai-compat",
    apiKeyEnv: envName.trim() || "OPENAI_API_KEY",
    baseUrl: trimmedUrl,
    model: trimmedModel,
    label: "Outro",
  };
}

async function runConfigWizard(
  dialog: Dialog,
  current: ProviderConfig,
): Promise<{ config: ProviderConfig; apiKey: string } | undefined> {
  const picked = await dialog.select<PresetId>({
    title: "Provedor de transcrição",
    current: current.presetId,
    options: [
      { value: "minimax", title: "MiniMax (padrão)" },
      { value: "openai", title: "OpenAI Whisper" },
      { value: "groq", title: "Groq" },
      { value: "other", title: "Outro (OpenAI-compatible)" },
    ],
  });
  if (!picked) return;

  const config = picked === "other" ? await promptCustomProvider(dialog) : configFromPreset(picked);
  if (!config) return;

  // dialog.prompt has no mask — the key is visible on screen.
  const apiKey = await dialog.prompt({
    title: "API key",
    description:
      "O texto aparece neste dialog (sem máscara) e será gravado em ~/.config/opencode/opencode-stt.secrets.json com permissão 600.",
    placeholder: "cole a chave",
  });
  if (apiKey === undefined) return;
  const trimmed = apiKey.trim();
  if (!trimmed) return;
  return { config, apiKey: trimmed };
}

export default define({
  id: "opencode-stt",

  async setup(context: Context) {
    const opts = (context.options ?? {}) as PluginOptions;
    const initialLang: Language =
      opts.language && (LANGUAGES as readonly string[]).includes(opts.language)
        ? (opts.language as Language)
        : "pt";

    const [langStore, mutateLang] = context.storage.store("language", {
      initial: { value: initialLang },
    });
    const [providerStore, mutateProvider] = context.storage.store("provider", {
      initial: seedFromOptions(opts),
    });
    const [stateStore, mutateState] = context.storage.memory("recording", {
      initial: { recorder: null } as RecordingState,
    });
    const [statusStore, mutateStatus] = context.storage.memory("stt-status", {
      initial: { phase: "idle", spin: 0 } as StatusState,
    });
    // Memory store survives hot reload; drop a leftover chip from the previous generation.
    mutateStatus((draft) => {
      draft.phase = "idle";
      draft.spin = 0;
    });

    let successTimer: ReturnType<typeof setTimeout> | undefined;
    let spinTimer: ReturnType<typeof setInterval> | undefined;
    const clearStatusTimers = () => {
      clearTimeout(successTimer);
      clearInterval(spinTimer);
      successTimer = undefined;
      spinTimer = undefined;
    };
    const setPhase = (phase: SttPhase) => {
      clearStatusTimers();
      mutateStatus((draft) => {
        draft.phase = phase;
        if (phase === "transcribing") draft.spin = 0;
      });
      if (phase === "transcribing") {
        spinTimer = setInterval(() => {
          mutateStatus((draft) => {
            draft.spin += 1;
          });
        }, 80);
      } else if (phase === "success") {
        successTimer = setTimeout(() => {
          successTimer = undefined;
          mutateStatus((draft) => {
            if (draft.phase === "success") draft.phase = "idle";
          });
        }, SUCCESS_MS);
      }
    };

    const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info", duration = 3000) =>
      context.ui.toast.show({ message, variant, duration });

    const currentLanguage = (): string | undefined => {
      const v = langStore.value as Language;
      return v === "auto" ? undefined : v;
    };

    // Call-time: core invokes this on finalize, so read store + secrets now.
    const getProvider = (): ProviderResult => {
      const resolved = resolveRuntime(providerStore, opts, process.env, readSecretsSync());
      if (!resolved.ok) return { ok: false, error: resolved.error };
      if (resolved.provider === "minimax") {
        return { ok: true, provider: createMiniMax({ apiKey: resolved.apiKey }), language: currentLanguage() };
      }
      return {
        ok: true,
        provider: createOpenAICompat({
          baseUrl: resolved.baseUrl,
          model: resolved.model,
          apiKey: resolved.apiKey,
        }),
        // ponytail: most OpenAI-compat servers ignore the language hint,
        // and the openai-compat provider discards it anyway — skip the wire.
        language: undefined,
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
      setPhase,
    });

    // setup runs OUTSIDE Solid's <Keymap.Provider> in OpenCode 2.0.3, so
    // keymap.layer() must be invoked from a slot's render (which is in scope).
    context.ui.slot({
      append: "app",
      render: () => {
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
                  toast(
                    core.isBusy()
                      ? "Transcrição em andamento — aguarde (limite 180s)."
                      : "Nenhuma gravação ativa.",
                    "info",
                  );
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
              id: "stt.config",
              title: "STT: configurar provedor",
              description: "Escolhe o provedor de transcrição e grava a API key.",
              group: "opencode-stt",
              palette: true,
              slash: { name: "stt-config" },
              run: async () => {
                const result = await runConfigWizard(context.ui.dialog, providerStore);
                if (!result) return;
                try {
                  await writeSecret(result.config.apiKeyEnv, result.apiKey);
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Falha ao gravar a chave.", "error", 5000);
                  return;
                }
                await mutateProvider((draft) => {
                  draft.presetId = result.config.presetId;
                  draft.provider = result.config.provider;
                  draft.apiKeyEnv = result.config.apiKeyEnv;
                  draft.baseUrl = result.config.baseUrl;
                  draft.model = result.config.model;
                  draft.label = result.config.label;
                });
                toast(`Provedor: ${result.config.label}`, "success");
              },
            },
            {
              id: "stt.selftest",
              title: "STT: teste de inserção",
              // ponytail: prompt.paste is void — success toast proves the
              // dispatch fired, not that text landed; requires an open session.
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
        return null;
      },
    });

    // Do not `replace` this slot: it would suppress the host effort indicator.
    context.ui.slot({
      append: "prompt.footer.status",
      render: () =>
        renderAsrStatus(statusStore, {
          recording: context.theme.text.feedback.error.default,
          success: context.theme.text.feedback.success.default,
        }),
    });

    // Reap any ffmpeg process this generation owns, and also any orphan a
    // previous generation left in the shared memory store (hot reload or TUI
    // shutdown). cancel() is a no-op when there is no active recorder.
    return () => {
      clearStatusTimers();
      mutateStatus((draft) => {
        draft.phase = "idle";
        draft.spin = 0;
      });
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
