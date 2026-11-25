import { ProxyError } from "./engine.ts";
export async function takeDistributed(bucket: string, limit: number, url: string, key: string, request: typeof fetch = fetch): Promise<boolean> {
  if (!url || !key) throw new ProxyError(503,"Rate limit unavailable");
  try {
    const response = await request(new URL("/rest/v1/rpc/proxy_take_rate_limit",url), {
      method:"POST", headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({p_bucket:bucket,p_limit:limit}), redirect:"error",signal:AbortSignal.timeout(5000)
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    const allowed = await response.json();
    if (typeof allowed !== "boolean") throw new Error();
    return allowed;
  } catch { throw new ProxyError(503,"Rate limit unavailable"); }
}
export async function userBucket(subject: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(subject));
  return "drive-copy:user:"+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
