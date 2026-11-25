import { ProxyError } from "./engine.ts";

export async function verifyGoogleToken(token: string, clientId: string, request: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await request("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token), {
      redirect: "error", signal: AbortSignal.timeout(8000), cache: "no-store"
    });
  } catch { throw new ProxyError(503, "Token verification unavailable"); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProxyError(response.status === 400 || response.status === 401 ? 401 : 503, "Token verification failed");
  }
  const data = await response.json().catch(() => null);
  const audience = data?.aud ?? data?.audience;
  const party = data?.azp ?? data?.issued_to;
  if (audience !== clientId || (party !== undefined && party !== clientId) ||
      !(Number(data?.expires_in) > 0)) throw new ProxyError(401, "Invalid token audience or expiry");
  let subject = data?.sub ?? data?.user_id;
  if (typeof subject !== "string" || !subject) {
    let about: Response;
    try {
      about = await request("https://www.googleapis.com/drive/v3/about?fields=user(permissionId)", {
        headers: {Authorization: "Bearer " + token},
        redirect: "error", signal: AbortSignal.timeout(8000), cache: "no-store"
      });
    } catch { throw new ProxyError(503, "Drive identity verification unavailable"); }
    if (!about.ok) {
      await about.body?.cancel();
      throw new ProxyError(about.status === 401 ? 401 : about.status === 403 ? 403 : 503, "Drive identity verification failed");
    }
    const identity = await about.json().catch(() => null);
    subject = identity?.user?.permissionId;
  }
  if (typeof subject !== "string" || !subject || subject.length > 256)
    throw new ProxyError(401, "Token subject unavailable");
  return subject;
}

// Local isolate protection only; distributed limits require shared storage.
export class RateLimiter {
  private entries = new Map<string, {count:number; until:number}>();
  constructor(private limit: number, private windowMs: number, private maxKeys = 10000) {}
  take(key: string, now = Date.now()): boolean {
    const old = this.entries.get(key);
    if (old && old.until > now) {
      if (old.count >= this.limit) return false;
      old.count++;
      return true;
    }
    if (this.entries.size >= this.maxKeys) {
      for (const [k,v] of this.entries) if (v.until <= now) this.entries.delete(k);
      if (this.entries.size >= this.maxKeys && !this.entries.has(key)) return false;
    }
    this.entries.set(key,{count:1,until:now+this.windowMs});
    return true;
  }
}
