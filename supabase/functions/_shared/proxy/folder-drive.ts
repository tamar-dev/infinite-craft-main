import {forward, ProxyError, type Target} from "./engine.ts";
import {validateId,trashOperationFile} from "./file-operations.ts";
export const FOLDER="application/vnd.google-apps.folder";
const SHORTCUT="application/vnd.google-apps.shortcut";
const target:Target={origin:"https://www.googleapis.com",path:/^\/drive\/v3\/files(?:\/[\w-]+(?:\/copy)?)?$/,methods:["GET","POST"],headers:["authorization","content-type","x-goog-drive-resource-keys"]};
export interface FolderNode {sourceId:string;name:string;mimeType:string;key?:string;parent:number;depth:number;scanned?:boolean;pageToken?:string;destId?:string;cleaned?:boolean;}
export class PlanError extends Error {}
export class WriteRejected extends Error {}
export function parseFolderLink(link:string){
 let u:URL;try{u=new URL(link);}catch{throw new PlanError("invalid");}
 const id=u.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/)?.[1];
 const key=u.searchParams.get("resourcekey")??undefined;
 if(u.protocol!=="https:"||u.hostname!=="drive.google.com"||u.username||u.password||u.port||!id||id.length>256||(key&&!/^[\w-]{1,256}$/.test(key)))throw new PlanError("invalid");
 return {id,key};
}
function node(meta:any,parent:number,depth:number,key?:string):FolderNode{
 const sourceId=validateId(meta.id),mimeType=String(meta.mimeType||"");
 if(typeof meta.name!=="string"||!mimeType)throw new PlanError("folderUnsupported");
 if(mimeType===SHORTCUT||meta.trashed)throw new PlanError("folderUnsupported");
 if(mimeType===FOLDER?meta.capabilities?.canListChildren!==true:meta.capabilities?.canCopy!==true)throw new PlanError("blocked");
 if(depth>16)throw new PlanError("folderLimit");
 const resourceKey=meta.resourceKey??key;
 if(resourceKey&&!/^[\w-]{1,256}$/.test(resourceKey))throw new PlanError("invalid");
 return {sourceId,name:meta.name,mimeType,parent,depth,key:resourceKey,scanned:mimeType!==FOLDER};
}
export function folderDrive(token:string,request:typeof fetch=fetch){
 async function call(path:string,params:Record<string,string>,source?:{sourceId:string;key?:string},body?:unknown){
  const headers=new Headers({Authorization:"Bearer "+token});
  if(source?.key)headers.set("X-Goog-Drive-Resource-Keys",source.sourceId+"/"+source.key);
  if(body!==undefined)headers.set("Content-Type","application/json");
  const response=await forward(target,path+"?"+new URLSearchParams(params),{headers,method:body===undefined?"GET":"POST",body:body===undefined?undefined:JSON.stringify(body)},request);
  if(!response.ok){
   const status=response.status;await response.body?.cancel();
   if(body!==undefined&&[400,401,403,404].includes(status))throw new WriteRejected("blocked");
   if(body===undefined&&[400,403,404].includes(status))throw new PlanError("blocked");
   throw new ProxyError(502,"Drive request unavailable");
  }
  return await response.json();
 }
 const fields="id,name,mimeType,resourceKey,trashed,capabilities(canCopy,canListChildren)";
 return {
  async root(link:string){
   const {id,key}=parseFolderLink(link);
   const meta=await call("/drive/v3/files/"+id,{fields,supportsAllDrives:"true"},{sourceId:id,key});
   const root=node(meta,-1,0,key);
   if(root.mimeType!==FOLDER||root.sourceId!==id)throw new PlanError("invalid");
   return root;
  },
  async children(parent:FolderNode,index:number){
   const page=await call("/drive/v3/files",{q:"'"+parent.sourceId+"' in parents and trashed = false",fields:"nextPageToken,incompleteSearch,files("+fields+")",pageSize:"100",supportsAllDrives:"true",includeItemsFromAllDrives:"true",...(parent.pageToken?{pageToken:parent.pageToken}:{})},parent);
   if(page.incompleteSearch||!Array.isArray(page.files)||page.nextPageToken===parent.pageToken&&page.nextPageToken)throw new PlanError("folderUnsupported");
   return {nodes:page.files.map((m:any)=>node(m,index,parent.depth+1)) as FolderNode[],next:page.nextPageToken as string|undefined};
  },
  async create(item:FolderNode,parentId:string,operationId:string,index:number){
   const body={name:item.name,parents:[parentId],appProperties:{copyToMyDriveOperation:operationId,copyToMyDriveNode:String(index)}};
   const data=item.mimeType===FOLDER?await call("/drive/v3/files",{fields:"id",supportsAllDrives:"true"},undefined,{...body,mimeType:FOLDER}):await call("/drive/v3/files/"+item.sourceId+"/copy",{fields:"id",supportsAllDrives:"true"},item,body);
   return validateId(data.id);
  },
  async find(operationId:string,index:number){
   const ids=new Set<string>();let pageToken:string|undefined;
   do{
    const page=await call("/drive/v3/files",{q:"'me' in owners and trashed = false and appProperties has { key='copyToMyDriveOperation' and value='"+operationId+"' } and appProperties has { key='copyToMyDriveNode' and value='"+index+"' }",fields:"nextPageToken,incompleteSearch,files(id)",pageSize:"100",...(pageToken?{pageToken}:{})});
    if(page.incompleteSearch||!Array.isArray(page.files))throw Error("Incomplete recovery");
    for(const file of page.files)ids.add(validateId(file.id));
    if(page.nextPageToken&&page.nextPageToken===pageToken)throw Error("Invalid page token");
    pageToken=page.nextPageToken;
   }while(pageToken);
   return [...ids];
  },
  async trash(id:string,operationId:string,isFolder:boolean){
   if(isFolder){
    const page=await call("/drive/v3/files",{q:"'"+id+"' in parents and trashed = false",fields:"incompleteSearch,nextPageToken,files(id)",pageSize:"1",supportsAllDrives:"true",includeItemsFromAllDrives:"true"});
    if(page.incompleteSearch||page.nextPageToken||!Array.isArray(page.files)||page.files.length)throw Error("Refusing to trash nonempty destination folder");
   }
   await trashOperationFile(id,operationId,token,request);
  }
 };
}
export type FolderDrive=ReturnType<typeof folderDrive>;
