import { authorize, cors } from "../_shared/proxy/actions-common.ts";
import { OperationRepository } from "../_shared/proxy/operations.ts";
import { handleOperation } from "../_shared/proxy/operation-service.ts";
import { ProxyError } from "../_shared/proxy/engine.ts";
Deno.serve(async req=>{
  const c=cors(req);if(c.error)return c.error;
  try{
    const {token,payload,subject}=await authorize(req,c.clientId!,"drive-operation");
    const repo=new OperationRepository(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const response=await handleOperation(repo,subject,token,payload);
    return new Response(response.body,{status:response.status,headers:c.headers});
  }catch(error){
    return error instanceof ProxyError?c.reply({error:error.message},error.status):c.reply({error:"Operation unresolved; check status"},500);
  }
});
