import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

interface TimingState {
  startTime: number;
  lastText: string;
  lastThinking: string;
  totalChars: number;
}

const STATUS_KEY = "tps-tracker";
let currentTiming: TimingState | null = null;
let updateInterval: NodeJS.Timeout | null = null;

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function extractThinking(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "thinking"; thinking: string } => c.type === "thinking")
    .map((c) => c.thinking)
    .join("");
}

function estimateTokens(charCount: number): number {
  return Math.max(0, Math.round(charCount / 4));
}

function formatTps(tokens: number, elapsedMs: number): string {
  if (elapsedMs <= 0) return "0.0 tok/s";
  const tps = (tokens / elapsedMs) * 1000;
  if (tps >= 1000) return `${Math.round(tps)} tok/s`;
  if (tps >= 100) return `${Math.round(tps)} tok/s`;
  return `${tps.toFixed(1)} tok/s`;
}

function updateStatus(ctx: ExtensionContext, label: string, tps: string, streaming: boolean): void {
  const theme = ctx.ui.theme;
  const indicator = streaming ? theme.fg("accent", "● ") : theme.fg("success", "✓ ");
  const dimTps = theme.fg("dim", tps);
  ctx.ui.setStatus(STATUS_KEY, `${indicator}${label} ${dimTps}`);
}

function clearStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus(STATUS_KEY, undefined);
}

function stopInterval(): void {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

function startInterval(ctx: ExtensionContext): void {
  stopInterval();
  updateInterval = setInterval(() => {
    if (!currentTiming) return;
    const elapsed = Date.now() - currentTiming.startTime;
    const tokens = estimateTokens(currentTiming.totalChars);
    const tps = formatTps(tokens, elapsed);
    updateStatus(ctx, "Generating...", tps, true);
  }, 800);
}

export default function (pi: ExtensionAPI) {
  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    stopInterval();
    currentTiming = {
      startTime: Date.now(),
      lastText: "",
      lastThinking: "",
      totalChars: 0,
    };
    updateStatus(ctx, "Generating...", "0.0 tok/s", true);
    startInterval(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    if (event.message.role !== "assistant" || !currentTiming) return;

    const text = extractText(event.message);
    const thinking = extractThinking(event.message);

    // Track absolute content length — works regardless of provider batching
    currentTiming.totalChars = text.length + thinking.length;

    const elapsed = Date.now() - currentTiming.startTime;
    const tokens = estimateTokens(currentTiming.totalChars);
    const tps = formatTps(tokens, elapsed);
    updateStatus(ctx, "Generating...", tps, true);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant" || !currentTiming) return;
    stopInterval();

    const elapsed = Date.now() - currentTiming.startTime;

    // Prefer actual usage tokens when available
    const usage = event.message.usage;
    const outputTokens = usage?.output ?? 0;
    const tokens = outputTokens > 0
      ? outputTokens
      : estimateTokens(currentTiming.totalChars);

    const tps = formatTps(tokens, elapsed);
    const stopReason = event.message.stopReason;

    if (stopReason === "error" || stopReason === "aborted") {
      updateStatus(ctx, "Stopped", tps, false);
    } else {
      updateStatus(ctx, "Done", tps, false);
    }

    const timingSnapshot = currentTiming;
    setTimeout(() => {
      if (currentTiming === timingSnapshot) {
        clearStatus(ctx);
        currentTiming = null;
      }
    }, 8000);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopInterval();
    clearStatus(ctx);
    currentTiming = null;
  });

  pi.registerCommand("tps", {
    description: "Show current token generation speed",
    handler: async (_args, ctx) => {
      if (!currentTiming) {
        ctx.ui.notify("No active generation", "info");
        return;
      }
      const elapsed = Date.now() - currentTiming.startTime;
      const tokens = estimateTokens(currentTiming.totalChars);
      ctx.ui.notify(`${formatTps(tokens, elapsed)} (${tokens} tokens)`, "info");
    },
  });
}
