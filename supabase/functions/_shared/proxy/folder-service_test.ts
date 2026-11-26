import {FolderRepository,handleFolder,type FolderRow,type FolderPlan} from "./folder-service.ts";
import {FOLDER,PlanError,WriteRejected,parseFolderLink,type FolderDrive,type FolderNode,folderDrive} from "./folder-drive.ts";
const id="12345678-1234-1234-1234-123456789abc",link="https://drive.google.com/drive/folders/rootSource";
class MemoryRepo extends FolderRepository{
 row:FolderRow|null=null;
 constructor(){super("https://example.invalid","unused");}
 override async get(id:string,owner:string){return this.row?.id===id&&this.row?.owner_subject===owner?structuredClone(this.row):null;}
 override async create(id:string,owner:string,link:string){this.row={id,owner_subject:owner,source_link:link,version:0,plan:{state:"scanning",nodes:[],cancel:false}};return structuredClone(this.row);}
 override async update(row:FolderRow,plan:FolderPlan){if(this.row?.version!==row.version)return null;this.row={...row,version:row.version+1,plan:structuredClone(plan)};return structuredClone(this.row);}
}
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw Error("Expected "+JSON.stringify(b)+" got "+JSON.stringify(a));}
const n=(sourceId:string,parent:number,depth:number,mimeType=FOLDER):FolderNode=>({sourceId,name:sourceId,parent,depth,mimeType,scanned:mimeType!==FOLDER});
function fixture(){
 const repo=new MemoryRepo(),created:string[]=[],trashed:string[]=[],found:string[]=[];
 const drive:FolderDrive={
  root:async()=>n("rootSource",-1,0),
  children:async(parent,index)=>parent.sourceId==="rootSource"?(parent.pageToken?{nodes:[n("empty",index,1)],next:undefined}:{nodes:[n("sub",index,1),n("file",index,1,"application/pdf")],next:"page2"}):{nodes:parent.sourceId==="sub"?[n("nested",index,2,"text/plain")]:[],next:undefined},
  create:async(node,parentId)=>{created.push(node.sourceId+":"+parentId);return "dest_"+node.sourceId;},
  find:async()=>found,trash:async(file)=>{trashed.push(file);}
 };
 const call=async(action:string,owner="owner")=>{const r=await handleFolder(repo,owner,"token",{operationId:id,action,link,mode:"copy"},drive);return {status:r.status,...await r.json()};};
 const until=async(state:string)=>{for(let i=0;i<30;i++){const r=await call("advance");if(r.state===state)return r;if(r.status!==200)throw Error(JSON.stringify(r));}throw Error("State not reached "+state);};
 return {repo,drive,created,trashed,found,call,until};
}
Deno.test("nested folders, empty folders and multiple listing pages are preserved",async()=>{
 const f=fixture();equal((await f.call("prepare")).state,"scanning");
 equal((await f.call("status","other")).status,404);
 const result=await f.until("succeeded");
 equal(result.completed,5);equal(result.total,5);
 equal(f.created,["rootSource:root","sub:dest_rootSource","file:dest_rootSource","empty:dest_rootSource","nested:dest_sub"]);
 equal((await f.call("advance")).state,"succeeded");equal(f.created.length,5);
});
Deno.test("cancel before scanning finishes never writes to Drive",async()=>{
 const f=fixture();await f.call("prepare");await f.call("advance");
 equal((await f.call("cancel")).state,"cancelled");equal(f.created.length,0);
});
Deno.test("cancel after partial copy removes only created items, children first",async()=>{
 const f=fixture();await f.call("prepare");await f.until("copying");
 await f.call("advance");await f.call("advance");
 equal((await f.call("cancel")).state,"cleaning");
 await f.until("cancelled");equal(f.trashed,["dest_sub","dest_rootSource"]);
});
Deno.test("failed preflight does not create partial copies",async()=>{
 const f=fixture();f.drive.children=async()=>{throw new PlanError("blocked");};
 await f.call("prepare");const r=await f.until("failed");equal(r.reason,"blocked");equal(f.created.length,0);
});
Deno.test("definite write rejection rolls back earlier copies",async()=>{
 const f=fixture();const create=f.drive.create;
 f.drive.create=async(...args)=>{if(args[0].sourceId==="sub")throw new WriteRejected("blocked");return create(...args);};
 await f.call("prepare");const r=await f.until("failed");equal(r.reason,"blocked");equal(f.trashed,["dest_rootSource"]);
});
Deno.test("ambiguous write is not repeated or falsely cancelled",async()=>{
 const f=fixture();await f.call("prepare");await f.until("copying");
 f.drive.create=async()=>{f.created.push("uncertain");throw Error("timeout");};
 equal((await f.call("advance")).status,503);await f.call("cancel");
 const pending=await f.call("advance");equal(pending.state,"dispatching");equal(pending.confirmed,false);equal(f.created.length,1);
 f.found.push("dest_rootSource");await f.until("cancelled");equal(f.trashed,["dest_rootSource"]);
});
Deno.test("only one simultaneous advance can dispatch a write",async()=>{
 const f=fixture();await f.call("prepare");await f.until("copying");
 await Promise.all([f.call("advance"),f.call("advance")]);
 equal(f.created,["rootSource:root"]);
});
Deno.test("folder links are restricted to Drive and validated",()=>{
 equal(parseFolderLink("https://drive.google.com/drive/u/0/folders/abc?resourcekey=xyz"),{id:"abc",key:"xyz"});
 let rejected=false;try{parseFolderLink("https://evil.example/drive/folders/abc");}catch{rejected=true;}equal(rejected,true);
});
Deno.test("folder trash refuses unrelated live children",async()=>{
 let requests=0;const request:typeof fetch=async()=>{requests++;return Response.json({files:[{id:"unrelated"}]});};
 let rejected=false;try{await folderDrive("token",request).trash("folder",id,true);}catch{rejected=true;}equal(rejected,true);equal(requests,1);
});
