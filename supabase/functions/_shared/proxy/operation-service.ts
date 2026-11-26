import { OperationRepository, type Operation } from "./operations.ts";
import { copyFile, parseLink } from "./drive.ts";
import { findOperationCopies } from "./operation-reconcile.ts";
import { operationFile, trashOperationFile, validateId } from "./file-operations.ts";
import { ProxyError } from "./engine.ts";

export interface OperationDependencies {
  copy: typeof copyFile;
  find: typeof findOperationCopies;
  inspect: typeof operationFile;
  trash: typeof trashOperationFile;
}
const defaults:OperationDependencies={copy:copyFile,find:findOperationCopies,inspect:operationFile,trash:trashOperationFile};
export async function handleOperation(repo:OperationRepository,subject:string,token:string,payload:any,deps:OperationDependencies=defaults):Promise<Response>{
  const reply=(body:unknown,status=200)=>Response.json(body,{status});
  try{
    const id = payload?.operationId;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return reply({error:"Invalid operation ID"},400);
    async function get():Promise<Operation> {
      const op=await repo.get(id,subject);
      if(!op) throw new ProxyError(404,"Operation not found");
      return op;
    }
    function view(op:Operation) {
      return {operationId:id,state:op.state,mode:op.mode,
        file:op.result_id?{id:op.result_id,name:op.result_name}:null};
    }
    // Cleanup may be retried after a crashed worker. Only the durable, verified
    // result of this operation is eligible. Trashing the same ID is idempotent.
    async function clean(op:Operation):Promise<Operation> {
      if(!["cleaning","finalizing"].includes(op.state)||!op.result_id) return op;
      await deps.trash(op.result_id,id,token);
      return await repo.transition(id,subject,op.state,op.state==="cleaning"?"cancelled":"succeeded") ?? await get();
    }
    async function settle(file:{id:string;name:string}):Promise<Operation> {
      validateId(file.id);
      const result={id:file.id,name:String(file.name||"download")};
      for(let i=0;i<8;i++){
        const op=await get();
        if(op.result_id && op.result_id!==result.id) throw new Error("Conflicting operation result");
        if(op.state==="running"||op.state==="uncertain"||op.state==="cancel_requested"){
          const next=op.state==="cancel_requested"?"cleaning":op.mode==="copy"?"succeeded":"ready";
          const changed=await repo.transition(id,subject,op.state,next,result);
          if(changed)return await clean(changed);
        }else return await clean(op);
      }
      throw new Error("Operation changed; retry status");
    }
    if(payload.action==="prepare"){
      const {link,mode}=payload;
      if(typeof link!=="string"||link.length>4096||!["copy","download","both"].includes(mode))return reply({error:"Invalid request"},400);
      parseLink(link);
      let op=await repo.get(id,subject);
      if(!op){
        try{op=await repo.create(id,subject,link,mode);}
        catch{op=await get();}
      }
      if(op.source_link!==link||op.mode!==mode)return reply({error:"Operation conflict"},409);
      return reply(view(op));
    }
    let op=await get();
    if(payload.action==="status")return reply(view(op));
    if(payload.action==="cancel"){
      for(let i=0;i<8;i++){
        op=await get();
        if(op.state==="pending"){
          if(await repo.transition(id,subject,"pending","cancelled"))break;
        }else if(["running","uncertain","ready"].includes(op.state)){
          if(await repo.transition(id,subject,op.state,"cancel_requested"))break;
        }else break;
      }
      op=await get();
      if(op.state==="cancel_requested"&&op.result_id)
        op=await repo.transition(id,subject,"cancel_requested","cleaning")??await get();
      return reply(view(await clean(op)));
    }
    if(payload.action==="recover"){
      if(["cleaning","finalizing"].includes(op.state))return reply(view(await clean(op)));
      if(!["running","uncertain","cancel_requested"].includes(op.state))return reply(view(op));
      const copies=await deps.find(id,token);
      if(copies.length===1){
        const file=await deps.inspect(copies[0],id,token);
        return reply(view(await settle(file)));
      }
      // No result is not proof of failure: a Google request can still commit.
      return reply({...view(await get()),confirmed:false,observedCount:copies.length});
    }
    if(payload.action==="finish"){
      if(op.state==="ready"){
        const next=op.mode==="download"?"finalizing":"succeeded";
        op=await repo.transition(id,subject,"ready",next)??await get();
      }
      return reply(view(await clean(op)));
    }
    if(payload.action!=="start")return reply({error:"Invalid action"},400);
    const claimed=await repo.transition(id,subject,"pending","running");
    if(!claimed)return reply(view(await get()));
    let dispatched=false;
    try{
      const file=await deps.copy(claimed.source_link,token,fetch,id,async()=>{
        if((await get()).state!=="running")throw new Error("Cancelled before dispatch");
        dispatched=true;
      });
      return reply(view(await settle(file)));
    }catch(error){
      if(!dispatched){
        for(let attempt=0;attempt<8;attempt++){
          op=await get();
          if(op.state!=="running"&&op.state!=="cancel_requested")break;
          const next=op.state==="running"?"failed":"cancelled";
          if(await repo.transition(id,subject,op.state,next))break;
        }
        op=await get();
        if(op.state==="failed")return reply({...view(op),error:error instanceof ProxyError?error.message:"Copy failed"});
      }else{
        await repo.transition(id,subject,"running","uncertain");
      }
      return reply(view(await get()));
    }
  } catch(error){
    return error instanceof ProxyError?reply({error:error.message},error.status):reply({error:"Operation unresolved; check status"},500);
  }
}
