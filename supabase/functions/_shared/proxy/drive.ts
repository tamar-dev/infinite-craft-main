import { forward, ProxyError, type Target } from "./engine.ts";
const target: Target = {
  origin: "https://www.googleapis.com",
  path: /^\/drive\/v3\/files\/[\w-]+(?:\/copy)?$/,
  methods: ["GET", "POST"],
  headers: ["authorization", "content-type", "x-goog-drive-resource-keys"]
};
export function parseLink(value: string) {
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new ProxyError(400, "Invalid link"); }
  if (u.protocol !== "https:" || !["drive.google.com","docs.google.com"].includes(u.hostname) || u.username || u.password || u.port)
    throw new ProxyError(400, "Not a Google Drive link");
  const id = u.pathname.match(/\/d\/([\w-]+)(?:\/|$)/)?.[1] || u.searchParams.get("id");
  const key = u.searchParams.get("resourcekey");
  if (!id || !/^[\w-]{1,256}$/.test(id) || /\/folders\//.test(u.pathname)) throw new ProxyError(400, "Unsupported link");
  if (key && !/^[\w-]{1,256}$/.test(key)) throw new ProxyError(400, "Invalid resource key");
  return {id,key};
}
export async function copyFile(link: string, token: string, request: typeof fetch = fetch) {
  const {id,key} = parseLink(link);
  const headers = new Headers({Authorization: "Bearer " + token});
  if (key) headers.set("X-Goog-Drive-Resource-Keys", id + "/" + key);
  const base = "/drive/v3/files/" + id;
  async function call(path: string, init: RequestInit) {
    const r = await forward(target, path, init, request);
    if (!r.ok) {
      await r.body?.cancel();
      const status = [401,403,404,429].includes(r.status) ? r.status : 502;
      throw new ProxyError(status, "Drive API request failed (" + r.status + ")");
    }
    try { return await r.json(); } catch { throw new ProxyError(502, "Invalid Drive response"); }
  }
  const meta = await call(base + "?fields=name,mimeType,capabilities(canCopy)&supportsAllDrives=true", {headers});
  if (["application/vnd.google-apps.folder","application/vnd.google-apps.shortcut"].includes(meta.mimeType))
    throw new ProxyError(400, "Folders and shortcuts are not supported");
  if (!meta.capabilities?.canCopy) throw new ProxyError(403, "Copying is not permitted");
  if (typeof meta.name !== "string") throw new ProxyError(502, "Invalid Drive metadata");
  headers.set("Content-Type", "application/json");
  return call(base + "/copy?fields=id,name,webViewLink&supportsAllDrives=true", {method:"POST", headers, body:JSON.stringify({name:meta.name,parents:["root"]})});
}
