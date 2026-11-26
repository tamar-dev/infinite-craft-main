import {authorize,cors} from "../_shared/proxy/actions-common.ts";
import {FolderRepository,handleFolder} from "../_shared/proxy/folder-service.ts";
import {ProxyError} from "../_shared/proxy/engine.ts";
Deno.serve(async req=>{
 const c=cors(req);if(c.error)return c.error;
 try{
  const {token,payload,subject}=await authorize(req,c.clientId!,"drive-folder");
  const repo=new FolderRepository(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const response=await handleFolder(repo,subject,token,payload);
  return new Response(response.body,{status:response.status,headers:c.headers});
 }catch(e){return e instanceof ProxyError?c.reply({error:e.message},e.status):c.reply({error:"Folder service unavailable"},503);}
});
