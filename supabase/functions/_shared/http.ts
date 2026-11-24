import { HttpError, secret } from "./ai-service.ts";
export function handler(action: (body: any) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== "POST") throw new HttpError(405, "POST required");
      const expected = secret("AI_GATEWAY_KEY");
      const supplied = req.headers.get("x-ai-gateway-key") || "";
      const encoder = new TextEncoder();
      const a = await crypto.subtle.digest("SHA-256", encoder.encode(expected));
      const b = await crypto.subtle.digest("SHA-256", encoder.encode(supplied));
      let diff = 0;
      for (let i=0;i<32;i++) diff |= new Uint8Array(a)[i] ^ new Uint8Array(b)[i];
      if (diff) throw new HttpError(401, "Unauthorized");
      let body;
      try { const raw = await req.text(); if (raw.length > 30000) throw new Error(); body = JSON.parse(raw); }
      catch { throw new HttpError(400, "Invalid or oversized JSON"); }
      return Response.json(await action(body), {headers:{"Cache-Control":"no-store"}});
    } catch (error) {
      return Response.json({error:error instanceof HttpError ? error.message : "Request failed"}, {status:error instanceof HttpError ? error.status : 502, headers:{"Cache-Control":"no-store"}});
    }
  };
}
