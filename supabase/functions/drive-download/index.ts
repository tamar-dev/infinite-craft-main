import {cors,authorize} from "../_shared/proxy/actions-common.ts";
import {OperationRepository} from "../_shared/proxy/operations.ts";
import {getExport} from "../_shared/proxy/file-operations.ts";
import {ProxyError} from "../_shared/proxy/engine.ts";
Deno.serve(async req=>{
 const c=cors(req);if(c.error)return c.error;
 try{
  const {token,payload,subject}=await authorize(req,c.clientId!,"drive-download");
  const operationId=payload?.operationId;
  if(typeof operationId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId))throw new ProxyError(400,"Invalid operation ID");
  const repo=new OperationRepository(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const op=await repo.get(operationId,subject);
  if(!op||op.state!=="ready"||op.mode==="copy"||!op.result_id||op.result_id!==payload?.fileId)throw new ProxyError(403,"Download not available for this operation");
  const {url,name,mime}=await getExport(op.result_id,token,fetch,operationId);
  // Return bytes as a direct response to avoid staging copies or making a public proxy.
  let upstream:Response;
  try{upstream=await fetch(url,{headers:{Authorization:"Bearer "+token},redirect:"error",signal:AbortSignal.timeout(90000)});}
  catch{throw new ProxyError(502,"Download unavailable");}
  if(!upstream.ok){await upstream.body?.cancel();throw new ProxyError([401,403,404,429].includes(upstream.status)?upstream.status:502,"Download failed");}
  const headers=new Headers(c.headers);
  headers.set("Content-Type",mime||"application/octet-stream");
  headers.set("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(name));
  headers.set("X-Download-Name",encodeURIComponent(name));
  headers.set("Access-Control-Expose-Headers","X-Download-Name, X-Download-Size");
  const length=upstream.headers.get("Content-Length");
  const encoding=upstream.headers.get("Content-Encoding");
  if(length&&/^\d+$/.test(length)&&(!encoding||encoding==="identity"))headers.set("X-Download-Size",length);
  headers.delete("Content-Length");
  return new Response(upstream.body,{status:200,headers});
 }catch(e){return e instanceof ProxyError?c.reply({error:e.message},e.status):c.reply({error:"Request failed"},500);}
});
