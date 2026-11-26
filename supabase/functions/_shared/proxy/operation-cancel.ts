import { OperationRepository, type OperationState } from "./operations.ts";
import { trashFile } from "./file-operations.ts";

export async function requestCancellation(repo: OperationRepository, id: string, owner: string): Promise<OperationState> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const operation = await repo.get(id, owner);
    if (!operation) throw new Error("Operation not found");
    if (operation.state !== "pending" && operation.state !== "running") return operation.state;
    const updated = await repo.transition(id, owner, operation.state, "cancel_requested");
    if (updated) return updated.state;
  }
  throw new Error("Operation state changed; retry cancellation");
}

// Internal worker primitive only. Caller must establish that all copy requests
// have settled and all resulting IDs are registered before invoking cleanup.
// Never invoke directly from the cancellation HTTP handler.
export async function cleanupAfterWorkerStopped(
  repo: OperationRepository, id: string, owner: string, token: string,
  trash: typeof trashFile = trashFile
): Promise<OperationState> {
  const operation = await repo.get(id, owner);
  if (!operation) throw new Error("Operation not found");
  if (operation.state !== "cancel_requested" && operation.state !== "cleanup_failed") return operation.state;
  const claimed = await repo.transition(id, owner, operation.state, "cleaning");
  if (!claimed) return (await repo.get(id, owner))!.state;
  try {
    // Bound work per invocation; retries resume from the ledger.
    for (let batch = 0; batch < 10; batch++) {
      const files = await repo.listPendingFiles(id, owner);
      if (!files.length) {
        const finished = await repo.transition(id, owner, "cleaning", "cancelled");
        if (!finished) throw new Error("Cleanup state changed");
        return finished.state;
      }
      for (const file of files) {
        await trash(file, token);
        await repo.markCleaned(id, owner, file);
      }
    }
    throw new Error("Cleanup requires another batch");
  } catch {
    const failed = await repo.transition(id, owner, "cleaning", "cleanup_failed");
    if (!failed) throw new Error("Unable to persist cleanup status");
    return failed.state;
  }
}
