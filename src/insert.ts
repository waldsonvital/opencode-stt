import { spawn } from "node:child_process";
import type { Context } from "@opencode/plugin/tui/plugin";

/**
 * Inserts `text` into the active composer by:
 *  1. saving the current Wayland clipboard,
 *  2. replacing it with the new text,
 *  3. dispatching the built-in `prompt.paste` command (the only append path
 *     exposed by OpenCode V2),
 *  4. restoring the original clipboard once the TUI has had time to read it.
 *
 * The save/restore dance keeps secrets copied to the clipboard before the
 * dictation from being clobbered.
 */
export async function appendViaClipboard(ctx: Context, text: string): Promise<void> {
  const saved = await run("wl-paste", ["--no-newline"]);
  const savedText = saved.ok ? saved.stdout : "";

  const copied = await run("wl-copy", [text]);
  if (!copied.ok) {
    throw new Error(
      `wl-copy falhou: ${copied.stderr || "comando indisponível"}. ` +
        "O opencode-stt precisa de wl-clipboard no Wayland.",
    );
  }

  ctx.keymap.dispatch("prompt.paste");
  await sleep(180);

  await run("wl-copy", [savedText]);
}

export async function submitDirect(ctx: Context, text: string): Promise<void> {
  const route = ctx.ui.router.current();
  if (route.type !== "session") {
    throw new Error("Nenhuma sessão ativa para enviar o prompt.");
  }
  await ctx.client.session.prompt({
    sessionID: route.sessionID,
    text,
  });
}

interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    child.once("error", (e) => resolve({ ok: false, stdout: "", stderr: e.message }));
    child.once("exit", (code) =>
      resolve({
        ok: code === 0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}