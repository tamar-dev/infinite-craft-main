import {cors,authorize} from "../_shared/proxy/actions-common.ts";
import {trashFile} from "../_shared/proxy/file-operations.ts";
import {ProxyError} from "../_shared/proxy/engine.ts";
Deno.serve(async req=>{
 const c=cors(req);if(c.error)return c.error;
 try{
  const {token,payload}=await authorize(req,c.clientId!,"drive-trash");
  return c.reply(await trashFile(payload?.fileId,token));
 }catch(e){return e instanceof ProxyError?c.reply({error:e.message},e.status):c.reply({error:"Request failed"},500);}
});
