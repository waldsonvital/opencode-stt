import type { Recorder } from "./recorder.ts";
import { SttError, type SttProvider } from "./providers/types.ts";

export type Mode = "append" | "submit";

export type ProviderResult =
  | { readonly ok: true; readonly provider: SttProvider; readonly language: string | undefined }
  | { readonly ok: false; readonly error: string };

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface CoreDeps {
  readonly startRecording: () => Promise<Recorder>;
  readonly getProvider: () => ProviderResult;
  readonly insertAppend: (text: string) => Promise<void>;
  readonly insertSubmit: (text: string) => Promise<void>;
  readonly cleanupFile: (path: string) => Promise<void>;
  readonly toast: (message: string, variant?: ToastVariant, duration?: number) => void;
  /** Mirrors the active recorder into the host's persistent memory store. */
  readonly persistRecorder: (rec: Recorder | null) => void;
}

export interface CoreHandle {
  startToggle(mode: Mode): Promise<void>;
  /** Cancels the active recording, if any. Returns true when something was cancelled. */
  cancel(): boolean;
  hasRecorder(): boolean;
}

/**
 * Toggle + finalize state machine for the STT flow. Owns the in-process
 * `busy` guard that serialises the whole cycle (start → stop → transcribe →
 * insert) so a rapid double-tap cannot spawn a second ffmpeg or wipe the WAV
 * written by an in-flight transcribe.
 */
export function createCore(deps: CoreDeps): CoreHandle {
  let recorder: Recorder | null = null;
  // ponytail: single boolean; survives only within a plugin generation. A
  // TUI hot reload drops the in-flight toggle (the recorder process itself
  // persists in storage and is reaped by the teardown cleanup).
  let busy = false;

  const startToggle = async (mode: Mode): Promise<void> => {
    if (busy) {
      deps.toast("STT ocupado: aguarde o ciclo anterior terminar.", "warning");
      return;
    }
    if (recorder) {
      await finalizeAndInsert(mode);
    } else {
      await startNewRecording(mode);
    }
  };

  const startNewRecording = async (mode: Mode): Promise<void> => {
    busy = true;
    try {
      const rec = await deps.startRecording();
      recorder = rec;
      deps.persistRecorder(rec);
      deps.toast(
        mode === "append"
          ? "Gravando… ctrl+alt+v para transcrever e inserir."
          : "Gravando… <leader>v para transcrever e enviar.",
        "info",
        3000,
      );
    } catch (e) {
      deps.toast(
        `Não foi possível iniciar a gravação: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        5000,
      );
    } finally {
      busy = false;
    }
  };

  const finalizeAndInsert = async (mode: Mode): Promise<void> => {
    busy = true;
    const rec = recorder;
    recorder = null;
    deps.persistRecorder(null);
    try {
      const prov = deps.getProvider();
      if (!prov.ok) {
        deps.toast(prov.error, "error", 5000);
        return;
      }
      if (!rec) return;
      const path = rec.outputPath;
      await rec.stop();
      deps.toast("Transcrevendo…", "info", 1500);
      try {
        const res = await prov.provider.transcribe(path, { language: prov.language });
        await deps.cleanupFile(path);
        if (!res.text) {
          deps.toast("Nenhuma fala detectada.", "warning");
          return;
        }
        if (mode === "append") {
          await deps.insertAppend(res.text);
          deps.toast("Texto inserido no composer.", "success");
        } else {
          await deps.insertSubmit(res.text);
          deps.toast("Prompt enviado.", "success");
        }
      } catch (e) {
        await deps.cleanupFile(path);
        const msg = e instanceof SttError ? e.message : e instanceof Error ? e.message : String(e);
        deps.toast(`STT falhou: ${msg}`, "error", 6000);
      }
    } finally {
      busy = false;
    }
  };

  const cancel = (): boolean => {
    if (!recorder) return false;
    recorder.cancel();
    recorder = null;
    deps.persistRecorder(null);
    return true;
  };

  return {
    startToggle,
    cancel,
    hasRecorder: () => recorder !== null,
  };
}
