import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Instance } from "../../shared/types/index.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertChromaUpgradeNotInProgress } from "../updates/updateControl.js";

const updating = new Map<string, symbol>();
const owner = new AsyncLocalStorage<ReadonlyMap<string, symbol>>();

export function getAddonUpdateJournalPath(instance: Instance): string {
  return join(instance.instancePath, "csm", "addon-update.json");
}

export function assertNoAddonUpdateInProgress(instance: Instance): void {
  const reservation = updating.get(instance.id);
  if ((reservation || existsSync(getAddonUpdateJournalPath(instance))) && (!reservation || reservation !== owner.getStore()?.get(instance.id))) {
    throw new Error("An addon update or its recovery is in progress. Wait for it to finish before changing this instance.");
  }
}

export function isInstanceMutationInProgress(instanceId: string): boolean { return updating.has(instanceId); }

// Nested service calls keep their reservation; unrelated API requests cannot enter it.
export async function runInstanceMutation<T>(instance: Instance, operation: () => Promise<T>, recovery = false): Promise<T> {
  if (updating.has(instance.id) && updating.get(instance.id) === owner.getStore()?.get(instance.id)) return operation();
  assertChromaUpgradeNotInProgress();
  if (updating.has(instance.id)) throw new Error("Another operation is already changing this instance.");
  if (!recovery) assertNoAddonUpdateInProgress(instance);
  const token = Symbol(instance.id);
  updating.set(instance.id, token);
  try { return await owner.run(new Map([...(owner.getStore() ?? []), [instance.id, token]]), operation); }
  finally { updating.delete(instance.id); }
}
