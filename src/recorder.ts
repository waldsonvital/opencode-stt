import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

export const RECORDING_PATH = "/tmp/opencode/opencode-stt.wav";
const MAX_DURATION_MS = 495_000; // MiniMax limit is 500s; leave a safety margin.

export interface Recorder {
  readonly outputPath: string;
  stop(): Promise<void>;
  cancel(): void;
}

export interface RecordingOptions {
  /** Override the ffmpeg binary path (default: "ffmpeg"). Used by tests. */
  readonly ffmpegPath?: string;
}

/**
 * Starts an ffmpeg capture from the default PulseAudio/PipeWire source,
 * writing mono 16 kHz PCM WAV. SIGINT (not SIGKILL) is used so ffmpeg
 * finalises headers and flushes the file before exiting.
 */
export async function startRecording(opts: RecordingOptions = {}): Promise<Recorder> {
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  await mkdir(dirname(RECORDING_PATH), { recursive: true });

  const child = spawn(
    ffmpegPath,
    [
      "-y",
      "-f", "pulse",
      "-i", "default",
      "-ac", "1",
      "-ar", "16000",
      RECORDING_PATH,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  // ponytail: confirm birth before proceeding. Without this, a missing
  // ffmpeg binary emits `error` async and crashes the TUI host with
  // uncaughtException; rejecting here lets callers turn it into a toast.
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => resolve());
  });

  const timer = setTimeout(() => child.kill("SIGINT"), MAX_DURATION_MS);

  let stopping = false;
  const awaitExit = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      // ponytail: hard timeout fallback if the child ignores SIGINT.
      setTimeout(resolve, 3000).unref();
    });

  return {
    outputPath: RECORDING_PATH,
    async stop() {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGINT");
      await awaitExit();
    },
    cancel() {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGINT");
      rm(RECORDING_PATH, { force: true }).catch(() => {});
    },
  };
}