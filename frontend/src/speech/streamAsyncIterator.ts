// Safari doesn't support `for await (const chunk of readableStream)`.
// The phonemizer inside kokoro-js unpacks its language data that way, so in
// Safari it threw silently, never finished starting, and speech hung forever.
// This adds the missing async iterator. It must be imported before kokoro-js.

type IterableStream = ReadableStream & { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> };

const proto = (globalThis.ReadableStream?.prototype ?? null) as IterableStream | null;

if (proto && typeof proto[Symbol.asyncIterator] !== "function") {
  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* (this: ReadableStream) {
      const reader = this.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export {};
