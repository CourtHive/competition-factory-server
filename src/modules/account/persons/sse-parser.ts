// Minimal Server-Sent Events parser for consuming the courthive-persons
// /persons/events stream.
//
// SSE wire format we care about (what NestJS @Sse() emits):
//
//   event: personMerged
//   data: {"eventId":"...","survivorId":"...","deprecatedId":"...","occurredAt":"..."}
//   <blank line>
//
// We deliberately handle only event: + data: + blank-line-as-terminator.
// id:, retry:, and comments are ignored — courthive-persons doesn't emit
// them today, and we'd want to revisit anyway if/when they're added.

export interface SseEvent {
  event: string;
  data: any;
}

/**
 * Consume an SSE response body and call `handler` for each complete
 * `event:`-typed message. Returns when the stream closes or `signal`
 * aborts. Does NOT reconnect — that's the caller's job.
 */
export async function consumeSseStream(
  response: Response,
  handler: (event: SseEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      // Events are separated by a blank line.
      let separatorIdx;
      while ((separatorIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        const parsed = parseEventBlock(rawEvent);
        if (parsed) await handler(parsed);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // best-effort
    }
  }
}

function parseEventBlock(block: string): SseEvent | null {
  let eventName = 'message';
  let dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  try {
    return { event: eventName, data: JSON.parse(dataStr) };
  } catch {
    // Non-JSON data — we don't expect this from courthive-persons.
    return null;
  }
}
