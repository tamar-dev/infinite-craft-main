import {folderDrive,parseFolderLink,PlanError,WriteRejected,FOLDER,type FolderDrive,type FolderNode} from "./folder-drive.ts";
export type FolderState="scanning"|"copying"|"dispatching"|"cleaning"|"succeeded"|"cancelled"|"failed";
export interface FolderPlan {state:FolderState;nodes:FolderNode[];pending?:number;cancel:boolean;failure?:string;}
export interface FolderRow {id:string;owner_subject:string;source_link:string;version:number;plan:FolderPlan;}
export class FolderRepository {
 constructor(private url:string,private key:string,private request:typeof fetch=fetch){}
 private async query(params:Record<string,string>,method="GET",body?:unknown){
  const response=await this.request(new URL("/rest/v1/drive_folder_operations?"+new URLSearchParams(params),this.url),{method,headers:{apikey:this.key,Authorization:"Bearer "+this.key,"Content-Type":"application/json",Prefer:"return=representation"},body:body===undefined?undefined:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error("Folder operation storage unavailable");
  return await response.json() as FolderRow[];
 }
 async get(id:string,owner:string){return (await this.query({id:"eq."+id,owner_subject:"eq."+owner}))[0]??null;}
 async create(id:string,owner:string,link:string){return (await this.query({},"POST",{id,owner_subject:owner,source_link:link,plan:{state:"scanning",nodes:[],cancel:false}}))[0];}
 async update(row:FolderRow,plan:FolderPlan){return (await this.query({id:"eq."+row.id,owner_subject:"eq."+row.owner_subject,version:"eq."+row.version},"PATCH",{version:row.version+1,plan,updated_at:new Date().toISOString()}))[0]??null;}
}
const terminal=(p:FolderPlan)=>["succeeded","cancelled","failed"].includes(p.state);
export async function handleFolder(repo:FolderRepository,owner:string,token:string,payload:any,drive:FolderDrive=folderDrive(token)):Promise<Response>{
 const reply=(body:unknown,status=200)=>Response.json(body,{status});
 const id=payload?.operationId;
 if(typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return reply({error:"Invalid operation ID"},400);
 async function get(){const row=await repo.get(id,owner);if(!row)throw Error("Operation not found");return row;}
 function view(row:FolderRow){
  const p=row.plan,root=p.nodes[0];
  return {operationId:id,state:p.state,cancelRequested:p.cancel,completed:p.nodes.filter(n=>n.destId&&!n.cleaned).length,total:p.state==="scanning"?null:p.nodes.length,file:root?{id:root.destId,name:root.name}:null,reason:p.failure};
 }
 async function change(row:FolderRow,plan:FolderPlan){return await repo.update(row,plan)??await get();}
 async function settle(index:number,destId:string){
  for(let i=0;i<8;i++){
   const row=await get(),p=structuredClone(row.plan);
   if(p.state!=="dispatching"||p.pending!==index)return row;
   p.nodes[index].destId=destId;delete p.pending;
   p.state=p.cancel?"cleaning":p.nodes.every(n=>n.destId)?"succeeded":"copying";
   const updated=await repo.update(row,p);if(updated)return updated;
  }
  throw Error("Folder state changed");
 }
 async function rejectWrite(index:number,reason:string){
  for(let i=0;i<8;i++){
   const row=await get(),p=structuredClone(row.plan);
   if(p.state!=="dispatching"||p.pending!==index)return row;
   delete p.pending;p.state="cleaning";if(!p.cancel)p.failure=reason;
   const updated=await repo.update(row,p);if(updated)return updated;
  }
  throw Error("Folder state changed");
 }
 try{
  if(payload.action==="prepare"){
   if(typeof payload.link!=="string"||payload.link.length>4096||payload.mode!=="copy")return reply({error:"Invalid folder request"},400);
   parseFolderLink(payload.link);
   let row=await repo.get(id,owner);
   if(!row){try{row=await repo.create(id,owner,payload.link);}catch{row=await get();}}
   if(row.source_link!==payload.link)return reply({error:"Operation conflict"},409);
   return reply(view(row));
  }
  let row=await repo.get(id,owner);if(!row)return reply({error:"Operation not found"},404);
  let p=structuredClone(row.plan);
  if(payload.action==="status"||terminal(p))return reply(view(row));
  if(payload.action==="cancel"){
   for(let i=0;i<8;i++){
    p=structuredClone(row.plan);
    if(terminal(p))break;
    p.cancel=true;
    if(p.state==="scanning")p.state="cancelled";
    else if(p.state==="copying")p.state="cleaning";
    // A dispatched Google write must settle or be positively recovered first.
    const updated=await repo.update(row,p);
    if(updated){row=updated;break;}row=await get();
   }
   return reply(view(row));
  }
  if(payload.action!=="advance")return reply({error:"Invalid action"},400);
  if(p.state==="scanning"){
   try{
    if(!p.nodes.length)p.nodes.push(await drive.root(row.source_link));
    else{
     const index=p.nodes.findIndex(n=>n.mimeType===FOLDER&&!n.scanned);
     if(index<0)p.state="copying";
     else{
      const page=await drive.children(p.nodes[index],index);
      const seen=new Set(p.nodes.map(n=>n.sourceId));
      for(const n of page.nodes){if(seen.has(n.sourceId))throw new PlanError("folderUnsupported");seen.add(n.sourceId);p.nodes.push(n);}
      if(p.nodes.length>200)throw new PlanError("folderLimit");
      p.nodes[index].pageToken=page.next;p.nodes[index].scanned=!page.next;
      if(p.nodes.every(n=>n.scanned))p.state="copying";
     }
    }
   }catch(e){if(!(e instanceof PlanError))throw e;p.state="failed";p.failure=e.message;}
   return reply(view(await change(row,p)));
  }
  if(p.state==="copying"){
   const index=p.nodes.findIndex(n=>!n.destId);
   if(index<0){p.state="succeeded";return reply(view(await change(row,p)));}
   const node=p.nodes[index],parentId=node.parent<0?"root":p.nodes[node.parent].destId;
   if(!parentId)throw Error("Missing parent");
   p.state="dispatching";p.pending=index;
   // Only a successful versioned claim may send the Google write.
   const claimed=await repo.update(row,p);
   if(!claimed)return reply(view(await get()));
   try{return reply(view(await settle(index,await drive.create(node,parentId,id,index))));}
   catch(e){if(e instanceof WriteRejected)return reply(view(await rejectWrite(index,e.message)));throw e;}
  }
  if(p.state==="dispatching"){
   const index=p.pending;if(index===undefined)throw Error("Missing dispatch");
   const found=await drive.find(id,index);
   if(found.length===1)return reply(view(await settle(index,found[0])));
   return reply({...view(await get()),confirmed:false,observedCount:found.length});
  }
  if(p.state==="cleaning"){
   // Reverse order ensures descendants are cleaned before their parents.
   const node=[...p.nodes].reverse().find(n=>n.destId&&!n.cleaned);
   if(node){await drive.trash(node.destId!,id,node.mimeType===FOLDER);node.cleaned=true;}
   if(p.nodes.every(n=>!n.destId||n.cleaned))p.state=p.failure?"failed":"cancelled";
   return reply(view(await change(row,p)));
  }
  return reply(view(row));
 }catch(e){
  if(e instanceof PlanError)return reply({error:e.message},400);
  return reply({error:"Folder operation unresolved; retry status"},503);
 }
}
