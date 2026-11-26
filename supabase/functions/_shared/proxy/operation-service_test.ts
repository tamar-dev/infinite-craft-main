import { OperationRepository, type Operation, type OperationMode, type OperationState } from "./operations.ts";
import { handleOperation, type OperationDependencies } from "./operation-service.ts";
import { trashOperationFile } from "./file-operations.ts";
const id="12345678-1234-1234-1234-123456789abc",link="https://drive.google.com/file/d/source/view";
class MemoryRepo extends OperationRepository {
  row:Operation|null=null;
  constructor(){super("https://example.invalid","unused");}
  override async get(key:string,owner:string){return this.row?.id===key&&this.row?.owner_subject===owner?{...this.row}:null;}
  override async create(key:string,owner:string,source:string,mode:OperationMode):Promise<Operation>{
    if(this.row)throw Error("Duplicate");
    this.row={id:key,owner_subject:owner,source_link:source,mode,state:"pending",completed_items:0,total_items:null};
    return {...this.row};
  }
  override async transition(key:string,owner:string,from:OperationState,to:OperationState,result?:{id:string;name:string}){
    if(!this.row||this.row.id!==key||this.row.owner_subject!==owner||this.row.state!==from)return null;
    this.row={...this.row,state:to,...(result?{result_id:result.id,result_name:result.name,total_items:1,completed_items:1}:{})};
    return {...this.row};
  }
}
function equal(a:unknown,b:unknown){if(a!==b)throw Error("Expected "+JSON.stringify(b)+" got "+JSON.stringify(a));}
function gate(){let open!:()=>void;const promise=new Promise<void>(resolve=>open=resolve);return {promise,open};}
function fixture(){
  const repo=new MemoryRepo(),file={id:"newFile",name:"Report.pdf",webViewLink:"https://drive.google.com/open?id=newFile",trashed:false};
  const log={copies:0,trashes:0,found:[] as string[]};
  const deps:OperationDependencies={
    copy:async(_link,_token,_request,_id,beforeCopy)=>{await beforeCopy?.();log.copies++;return file;},
    find:async()=>log.found,
    inspect:async()=>file,
    trash:async(fileId,opId)=>{equal(fileId,file.id);equal(opId,id);log.trashes++;},
  };
  const call=async(action:string,extra:Record<string,unknown>={},owner="owner")=>{
    const response=await handleOperation(repo,owner,"token",{operationId:id,action,...extra},deps);
    return {status:response.status,...await response.json()};
  };
  const prepare=(mode:OperationMode="copy")=>call("prepare",{link,mode});
  return {repo,deps,log,call,prepare,file};
}
Deno.test("prepare is idempotent; operation owner is isolated",async()=>{
  const f=fixture();equal((await f.prepare()).state,"pending");equal((await f.prepare()).state,"pending");
  equal((await f.call("status",{},"other")).status,404);
  equal((await f.call("prepare",{link,mode:"both"})).status,409);
});
Deno.test("cancel before start never dispatches Google copy",async()=>{
  const f=fixture();await f.prepare();equal((await f.call("cancel")).state,"cancelled");
  equal((await f.call("start")).state,"cancelled");equal(f.log.copies,0);
});
Deno.test("duplicate starts claim at most one copy",async()=>{
  const f=fixture();await f.prepare();
  const entered=gate(),release=gate(),original=f.deps.copy;
  f.deps.copy=async(...args)=>{const file=await original(...args);entered.open();await release.promise;return file;};
  const first=f.call("start");await entered.promise;
  equal((await f.call("start")).state,"running");release.open();
  equal((await first).state,"succeeded");equal(f.log.copies,1);
  equal((await f.call("status")).file.id,f.file.id);
});
Deno.test("cancel while copy is in flight waits for its result and removes it",async()=>{
  const f=fixture();await f.prepare();
  const entered=gate(),release=gate(),original=f.deps.copy;
  f.deps.copy=async(...args)=>{const file=await original(...args);entered.open();await release.promise;return file;};
  const start=f.call("start");await entered.promise;
  equal((await f.call("cancel")).state,"cancel_requested");equal(f.log.trashes,0);
  release.open();equal((await start).state,"cancelled");equal(f.log.trashes,1);
});
Deno.test("unknown copy outcome is never retried or falsely cancelled; positive recovery cleans it",async()=>{
  const f=fixture();await f.prepare();
  f.deps.copy=async(_link,_token,_req,_op,before)=>{await before?.();f.log.copies++;throw Error("Timeout");};
  equal((await f.call("start")).state,"uncertain");equal((await f.call("start")).state,"uncertain");equal(f.log.copies,1);
  equal((await f.call("cancel")).state,"cancel_requested");
  const missing=await f.call("recover");equal(missing.state,"cancel_requested");equal(missing.confirmed,false);
  f.log.found=[f.file.id];
  equal((await f.call("recover")).state,"cancelled");equal(f.log.trashes,1);
});
Deno.test("definite preflight failure is terminal and makes no copy",async()=>{
  const f=fixture();await f.prepare();f.deps.copy=async()=>{throw Error("Denied");};
  equal((await f.call("start")).state,"failed");equal(f.log.trashes,0);
});
Deno.test("download-only cleanup is delayed until finish; both retains the copy",async()=>{
  for(const mode of ["download","both"] as const){
    const f=fixture();await f.prepare(mode);
    equal((await f.call("start")).state,"ready");equal(f.log.trashes,0);
    equal((await f.call("finish")).state,"succeeded");equal(f.log.trashes,mode==="download"?1:0);
    equal((await f.call("finish")).state,"succeeded");
  }
});
Deno.test("cleanup errors remain recoverable and are not reported as cancelled",async()=>{
  const f=fixture();await f.prepare("download");await f.call("start");
  const trash=f.deps.trash;f.deps.trash=async()=>{throw Error("Offline");};
  equal((await f.call("cancel")).status,500);equal((await f.call("status")).state,"cleaning");
  f.deps.trash=trash;equal((await f.call("recover")).state,"cancelled");
});
Deno.test("wrong operation marker never reaches Drive PATCH",async()=>{
  let requests=0;
  const request:typeof fetch=async(_url,init)=>{requests++;equal(init?.method,undefined);return Response.json({owners:[{me:true}],appProperties:{copyToMyDriveOperation:"other"}});};
  let rejected=false;try{await trashOperationFile("file",id,"token",request);}catch{rejected=true;}
  equal(rejected,true);equal(requests,1);
});
