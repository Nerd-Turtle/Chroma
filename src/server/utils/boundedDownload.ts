import { addAbortSignal, Readable } from "node:stream";

type DownloadPolicy = {
  label: string;
  maxBytes: number;
  timeoutMs: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
};

export class DownloadHttpError extends Error {
  constructor(readonly status: number, label: string) { super(`${label} failed with HTTP ${status}`); }
}

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Downloads require an HTTPS URL without credentials.");
  return url;
}

export async function withBoundedDownload<T>(
  url: string,
  policy: DownloadPolicy,
  consume: (chunks: AsyncIterable<Buffer>, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  // CWE-400: cap actual bytes, including decompressed/chunked bodies; Content-Length
  // alone is untrusted. One deadline covers headers, redirects, body and disk writes.
  // https://cwe.mitre.org/data/definitions/400.html
  // https://nodejs.org/docs/latest-v24.x/api/stream.html#streampipelinesource-transforms-destination-options
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, policy.timeoutMs);
  timer.unref();
  let response: Response | undefined;
  let source: Readable | undefined;
  try {
    let target = httpsUrl(url);
    for (let redirects = 0; ; redirects++) {
      response = await fetch(target.href, { signal: controller.signal, redirect: "manual", ...(policy.headers ? { headers: policy.headers } : {}) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      void response.body?.cancel().catch(() => {});
      const location = response.headers.get("location");
      if (!location || redirects >= (policy.maxRedirects ?? 5)) throw new Error(`${policy.label} exceeded its redirect limit.`);
      const next = httpsUrl(new URL(location, target).href);
      if (policy.headers && next.origin !== target.origin) throw new Error(`${policy.label} cannot forward headers to another origin.`);
      target = next;
    }
    if (!response.ok) throw new DownloadHttpError(response.status, policy.label);
    if (!response.body) throw new Error(`${policy.label} returned an empty body.`);
    const rawLength = response.headers.get("content-length");
    const length = rawLength === null ? undefined : Number(rawLength);
    if (rawLength !== null && (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(length))) throw new Error(`${policy.label} returned an invalid Content-Length.`);
    const sizeError = () => new Error(`${policy.label} exceeds the ${policy.maxBytes / 1024 / 1024} MiB limit.`);
    if (length !== undefined && length > policy.maxBytes) throw sizeError();
    controller.signal.throwIfAborted();
    source = addAbortSignal(controller.signal, Readable.fromWeb(response.body as import("node:stream/web").ReadableStream));
    const stream = source;
    const encoding = response.headers.get("content-encoding");
    async function* chunks(): AsyncGenerator<Buffer> {
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += (chunk as Buffer).length;
        if (bytes > policy.maxBytes) throw sizeError();
        yield chunk as Buffer;
      }
      if (bytes === 0) throw new Error(`${policy.label} returned an empty body.`);
      // Fetch transparently decodes compression; its Content-Length still counts wire bytes.
      if ((!encoding || encoding === "identity") && length !== undefined && length !== bytes) {
        throw new Error(`${policy.label} size does not match Content-Length.`);
      }
    }
    return await consume(chunks(), controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(`${policy.label} timed out after ${policy.timeoutMs / 1000} seconds.`);
    throw error;
  } finally {
    clearTimeout(timer);
    source?.destroy();
    if (!source) void response?.body?.cancel().catch(() => {});
    controller.abort();
  }
}

export function fetchBoundedText(url: string, policy: DownloadPolicy): Promise<string> {
  return withBoundedDownload(url, policy, async (chunks) => {
    const buffers: Buffer[] = [];
    for await (const chunk of chunks) buffers.push(chunk);
    // Buffer only small metadata responses; archives stream directly to a file.
    return Buffer.concat(buffers).toString("utf8");
  });
}
