import {cors,authorize} from "../_shared/proxy/actions-common.ts";
import {ProxyError} from "../_shared/proxy/engine.ts";
// Legacy arbitrary-file cleanup is disabled until operation-scoped download
// finalization is implemented. Never accept a client-supplied file ID to trash.
Deno.serve(async req=>{
 const c=cors(req);if(c.error)return c.error;
 try{
  await authorize(req,c.clientId!,"drive-trash");
  return c.reply({error:"Operation-scoped cleanup required"},410);
 }catch(e){return e instanceof ProxyError?c.reply({error:e.message},e.status):c.reply({error:"Request failed"},500);}
});
