import { OperationRepository, type Operation, type OperationState } from "./operations.ts";
import { requestCancellation, cleanupAfterWorkerStopped } from "./operation-cancel.ts";
const id = "12345678-1234-1234-1234-123456789abc";
class FakeRepo extends OperationRepository {
  state: OperationState = "pending";
  files = ["file1"];
  constructor(){super("https://example.invalid","unused");}
  override async get(_id:string, owner:string):Promise<Operation|null>{
    return owner === "owner" ? {id,owner_subject:owner,source_link:"link",mode:"copy",state:this.state,completed_items:0,total_items:null} : null;
  }
  override async transition(_id:string,owner:string,from:OperationState,to:OperationState){
    if(owner !== "owner" || this.state !== from)return null;
    this.state=to;return await this.get(id,owner);
  }
  override async listPendingFiles(){return [...this.files];}
  override async markCleaned(_id:string,_owner:string,file:string){this.files=this.files.filter(x=>x!==file);}
}
function equal(actual:unknown,expected:unknown){if(actual!==expected)throw new Error("Expected "+expected+" got "+actual);}
Deno.test("pending cancellation is terminal",async()=>{const r=new FakeRepo();equal(await requestCancellation(r,id,"owner"),"cancelled");});
Deno.test("running cancellation waits for worker",async()=>{const r=new FakeRepo();r.state="running";equal(await requestCancellation(r,id,"owner"),"cancel_requested");equal(r.files.length,1);});
Deno.test("worker cleanup completes only after trash",async()=>{const r=new FakeRepo();r.state="cancel_requested";equal(await cleanupAfterWorkerStopped(r,id,"owner","token",async()=>({trashed:true})),"cancelled");equal(r.files.length,0);});
Deno.test("failed cleanup does not report cancellation",async()=>{const r=new FakeRepo();r.state="cancel_requested";equal(await cleanupAfterWorkerStopped(r,id,"owner","token",async()=>{throw new Error("offline");}),"cleanup_failed");equal(r.files.length,1);});
