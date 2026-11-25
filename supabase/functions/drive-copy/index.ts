import { copyFile } from "../_shared/proxy/drive.ts";
import { ProxyError } from "../_shared/proxy/engine.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const allowed = Deno.env.get("DRIVE_COPY_EXTENSION_ORIGIN");
  const headers = new Headers({"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"});
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers});
  if (!allowed || !/^chrome-extension:\/\/[a-p]{32}$/.test(allowed)) return reply({error:"Service not configured"},503);
  if (origin && origin !== allowed) return reply({error:"Origin not allowed"},403);
  headers.set("Access-Control-Allow-Origin",allowed);
  headers.set("Access-Control-Allow-Methods","POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers","authorization, content-type");
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers});
  if (req.method !== "POST") return reply({error:"Method not allowed"},405);
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~+\/=-]{1,4096})$/i)?.[1];
  if (!token) return reply({error:"Google access token required"},401);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({error:"JSON required"},415);
  try {
    const reader = req.body?.getReader();
    if (!reader) return reply({error:"Body required"},400);
    const decoder = new TextDecoder();
    let size = 0, raw = "";
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return reply({error:"Body too large"},413); }
      raw += decoder.decode(value,{stream:true});
    }
    raw += decoder.decode();
    let data;
    try { data = JSON.parse(raw); } catch { return reply({error:"Invalid JSON"},400); }
    if (typeof data?.link !== "string" || data.link.length > 4096) return reply({error:"Link required"},400);
    return reply(await copyFile(data.link,token));
  } catch (error) {
    return error instanceof ProxyError ? reply({error:error.message},error.status) : reply({error:"Request failed"},500);
  }
});
