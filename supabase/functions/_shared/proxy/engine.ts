export class ProxyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface Target {
  origin: string;
  path: RegExp;
  methods: readonly string[];
  headers: readonly string[];
}
export async function forward(target: Target, path: string, init: RequestInit = {}, request: typeof fetch = fetch): Promise<Response> {
  const url = new URL(path, target.origin);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.protocol !== "https:" || url.origin !== target.origin || url.username || url.password || url.hash ||
      !target.path.test(url.pathname) || !target.methods.includes(method)) {
    throw new ProxyError(400, "Target not allowed");
  }
  const headers = new Headers();
  new Headers(init.headers).forEach((value, key) => {
    if (target.headers.includes(key)) headers.set(key, value);
  });
  const started = Date.now();
  try {
    const response = await request(url, {method, headers, body: init.body, redirect: "error", signal: AbortSignal.timeout(20000)});
    console.info(JSON.stringify({event:"proxy_response", target:target.origin, method, status:response.status, durationMs:Date.now()-started}));
    return response;
  } catch {
    console.warn(JSON.stringify({event:"proxy_transport_error", target:target.origin, method, durationMs:Date.now()-started}));
    throw new ProxyError(502, "Upstream request failed; operation outcome may be unknown");
  }
}
