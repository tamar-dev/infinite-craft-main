import { ProxyError } from "./engine.ts";
export function validateId(id:unknown):string {
 if(typeof id!=="string"||!/^[\w-]{1,256}$/.test(id))throw new ProxyError(400,"Invalid file ID");return id;
}
async function google(url:string,token:string,init:RequestInit={},request:typeof fetch=fetch) {
 let r:Response;try{r=await request(url,{...init,headers:{Authorization:"Bearer "+token,...init.headers},redirect:"error",signal:AbortSignal.timeout(20000)});}catch{throw new ProxyError(502,"Drive API unavailable");}
 if(!r.ok){const status=[401,403,404,429].includes(r.status)?r.status:502;await r.body?.cancel();throw new ProxyError(status,"Drive API request failed ("+r.status+")");}
 return r;
}
export async function getExport(id:string,token:string,request:typeof fetch=fetch) {
 id=validateId(id);
 const r=await google("https://www.googleapis.com/drive/v3/files/"+id+"?fields=id,name,mimeType,owners(me),capabilities(canDownload),trashed&supportsAllDrives=true",token,{},request);
 const meta=await r.json();
 if(meta.trashed||!Array.isArray(meta.owners)||!meta.owners.some((owner:{me?:boolean})=>owner.me===true))throw new ProxyError(403,"File must be owned by you");
 if(meta.capabilities?.canDownload===false)throw new ProxyError(403,"Downloading is not permitted");
 const types:Record<string,{mime:string;ext:string}>={
 "application/vnd.google-apps.document":{mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",ext:".docx"},
 "application/vnd.google-apps.spreadsheet":{mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",ext:".xlsx"},
 "application/vnd.google-apps.presentation":{mime:"application/vnd.openxmlformats-officedocument.presentationml.presentation",ext:".pptx"}
 };
 const native=String(meta.mimeType).startsWith("application/vnd.google-apps.");
 if(native&&!types[meta.mimeType])throw new ProxyError(400,"Unsupported Google file format");
 const format=types[meta.mimeType];
 const url="https://www.googleapis.com/drive/v3/files/"+id+(format?"/export?mimeType="+encodeURIComponent(format.mime):"?alt=media");
 return {url,name:String(meta.name||"download").replace(/[\\/\x00-\x1f]/g,"_")+(format?format.ext:""),mime:format?.mime||meta.mimeType};
}
export async function trashFile(id:unknown,token:string,request:typeof fetch=fetch) {
 id=validateId(id);
 const meta=await google("https://www.googleapis.com/drive/v3/files/"+id+"?fields=owners(me),trashed&supportsAllDrives=true",token,{},request);
 const data=await meta.json();
 if(!Array.isArray(data.owners)||!data.owners.some((owner:{me?:boolean})=>owner.me===true))throw new ProxyError(403,"File must be owned by you");
 if(data.trashed)return {trashed:true};
 await google("https://www.googleapis.com/drive/v3/files/"+id+"?supportsAllDrives=true",token,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({trashed:true})},request);
 return {trashed:true};
}

export async function operationFile(id:unknown,operationId:string,token:string,request:typeof fetch=fetch) {
  const fileId=validateId(id);
  const response=await google("https://www.googleapis.com/drive/v3/files/"+fileId+"?fields=id,name,webViewLink,owners(me),trashed,appProperties&supportsAllDrives=true",token,{},request);
  const data=await response.json();
  if(!data.owners?.some((owner:{me?:boolean})=>owner.me===true)||data.appProperties?.copyToMyDriveOperation!==operationId)
    throw new ProxyError(403,"File does not belong to this operation");
  return {id:fileId,name:String(data.name||"download"),webViewLink:data.webViewLink,trashed:data.trashed===true};
}
export async function trashOperationFile(id:string,operationId:string,token:string,request:typeof fetch=fetch) {
  const file=await operationFile(id,operationId,token,request);
  if(!file.trashed) await trashFile(id,token,request);
}
