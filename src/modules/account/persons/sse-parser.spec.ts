// Unit tests for the minimal SSE parser used by PersonsClient.
// Built around a small helper that feeds a synthetic ReadableStream
// (chunked, with partial events spanning chunk boundaries).

import { consumeSseStream, SseEvent } from './sse-parser';

function makeResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(stream);
}

describe('consumeSseStream', () => {
  it('parses a single event with event + data lines', async () => {
    const captured: SseEvent[] = [];
    await consumeSseStream(
      makeResponse(['event: personMerged\ndata: {"a":1}\n\n']),
      (event) => {
        captured.push(event);
      },
    );
    expect(captured).toEqual([{ event: 'personMerged', data: { a: 1 } }]);
  });

  it('parses multiple events in one chunk', async () => {
    const captured: SseEvent[] = [];
    await consumeSseStream(
      makeResponse([
        'event: personMerged\ndata: {"id":"e1"}\n\nevent: personMerged\ndata: {"id":"e2"}\n\n',
      ]),
      (event) => {
        captured.push(event);
      },
    );
    expect(captured.map((c) => c.data.id)).toEqual(['e1', 'e2']);
  });

  it('handles events split across chunk boundaries', async () => {
    const captured: SseEvent[] = [];
    await consumeSseStream(
      // Split mid-data so the parser must buffer.
      makeResponse(['event: personMerged\ndata: {"sur', 'vivorId":"S"}\n\n']),
      (event) => {
        captured.push(event);
      },
    );
    expect(captured).toEqual([{ event: 'personMerged', data: { survivorId: 'S' } }]);
  });

  it('defaults event name to "message" when no event: line', async () => {
    const captured: SseEvent[] = [];
    await consumeSseStream(makeResponse(['data: {"x":1}\n\n']), (event) => {
      captured.push(event);
    });
    expect(captured[0].event).toBe('message');
  });

  it('skips comment lines starting with `:`', async () => {
    const captured: SseEvent[] = [];
    await consumeSseStream(
      makeResponse([': keep-alive\nevent: personMerged\ndata: {"k":"v"}\n\n']),
      (event) => {
        captured.push(event);
      },
    );
    expect(captured).toEqual([{ event: 'personMerged', data: { k: 'v' } }]);
  });

  it('tolerates CRLF line endings', async () => {
    const captured: SseEvent[] = [];
    await consumeSseStream(
      makeResponse(['event: personMerged\r\ndata: {"crlf":true}\r\n\n']),
      (event) => {
        captured.push(event);
      },
    );
    expect(captured).toEqual([{ event: 'personMerged', data: { crlf: true } }]);
  });

  it('skips events with non-JSON data', async () => {
    const captured: SseEvent[] = [];
    await consumeSseStream(
      makeResponse(['event: personMerged\ndata: not-json\n\nevent: personMerged\ndata: {"ok":true}\n\n']),
      (event) => {
        captured.push(event);
      },
    );
    expect(captured.map((c) => c.data.ok)).toEqual([true]);
  });

  it('aborts when signal fires', async () => {
    const captured: SseEvent[] = [];
    const ac = new AbortController();
    const response = makeResponse([
      'event: personMerged\ndata: {"i":1}\n\n',
      'event: personMerged\ndata: {"i":2}\n\n',
    ]);
    // Pre-abort so the read loop returns immediately on the next chunk.
    ac.abort();
    await consumeSseStream(
      response,
      (event) => {
        captured.push(event);
      },
      ac.signal,
    );
    // With pre-aborted signal, no events are processed.
    expect(captured.length).toBe(0);
  });
});
