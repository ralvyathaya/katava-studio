import type { GenerationEvent } from "./types";

/** Decode NDJSON across arbitrary UTF-8/network boundaries. A truncated stream
 * is not a successful batch, even if some independent items already finished. */
export async function readGenerationStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: GenerationEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as GenerationEvent;
    if (event.type === "error") throw new Error(event.message);
    if (!["started", "progress", "result", "complete"].includes(event.type)) {
      throw new Error("Unknown generation stream event");
    }
    if (event.type === "complete") complete = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!complete) throw new Error("Connection ended before batch completion. Unfinished items are NOT verified; completed results are retained.");
  } finally {
    // Cancels remaining request-bound work if decoding or consumption failed.
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
