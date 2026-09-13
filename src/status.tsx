import type { JSX } from "@opentui/solid";
import type { SttPhase } from "./core.ts";

type Fg = NonNullable<JSX.IntrinsicElements["text"]["fg"]>;

// OpenTUI plugin scope has no <spinner>; frames are driven by store.spin ticks.
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

type AsrStatusStore = {
  readonly phase: SttPhase;
  readonly spin: number;
};

type AsrStatusColors = {
  readonly recording: Fg;
  readonly success: Fg;
};

/** Footer ASR chip: ● recording, braille spinner transcribing, ✓ success. Idle is null. */
export function renderAsrStatus(store: AsrStatusStore, colors: AsrStatusColors) {
  const phase = store.phase;
  if (phase === "idle") return null;

  const icon =
    phase === "recording" ? "●" : phase === "transcribing" ? SPIN[store.spin % SPIN.length] : "✓";
  const color = phase === "success" ? colors.success : colors.recording;

  return <text fg={color}>{`${icon} ASR`}</text>;
}
