import { validateId } from "./file-operations.ts";
export async function findOperationCopies(operationId: string, token: string, request: typeof fetch = fetch): Promise<string[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new Error("Invalid operation ID");
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.search = new URLSearchParams({q: "'me' in owners and trashed = false and appProperties has { key='copyToMyDriveOperation' and value='" + operationId + "' }", fields:"nextPageToken,incompleteSearch,files(id)",pageSize:"100",corpora:"user",...(pageToken ? {pageToken} : {})}).toString();
    const response = await request(url,{headers:{Authorization:"Bearer "+token},redirect:"error",signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error("Drive reconciliation failed");
    const page = await response.json();
    if (page.incompleteSearch || !Array.isArray(page.files)) throw new Error("Incomplete Drive reconciliation");
    for (const file of page.files) ids.add(validateId(file.id));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return [...ids];
}
