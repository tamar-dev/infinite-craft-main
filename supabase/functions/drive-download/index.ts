import {cors,authorize} from "../_shared/proxy/actions-common.ts";
import {getExport} from "../_shared/proxy/file-operations.ts";
import {ProxyError} from "../_shared/proxy/engine.ts";
Deno.serve(async req=>{
 const c=cors(req);if(c.error)return c.error;
 try{
  const {token,payload}=await authorize(req,c.clientId!,"drive-download");
  const {url,name,mime}=await getExport(payload?.fileId,token);
  // Return bytes as a direct response to avoid staging copies or making a public proxy.
  let upstream:Response;
  try{upstream=await fetch(url,{headers:{Authorization:"Bearer "+token},redirect:"error",signal:AbortSignal.timeout(90000)});}
  catch{throw new ProxyError(502,"Download unavailable");}
  if(!upstream.ok){await upstream.body?.cancel();throw new ProxyError([401,403,404,429].includes(upstream.status)?upstream.status:502,"Download failed");}
  const headers=new Headers(c.headers);
  headers.set("Content-Type",mime||"application/octet-stream");
  headers.set("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(name));
  headers.set("X-Download-Name",encodeURIComponent(name));
  headers.set("Access-Control-Expose-Headers","X-Download-Name");
  headers.delete("Content-Length");
  return new Response(upstream.body,{status:200,headers});
 }catch(e){return e instanceof ProxyError?c.reply({error:e.message},e.status):c.reply({error:"Request failed"},500);}
});
