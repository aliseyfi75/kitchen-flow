import { KitchenState, SyncMetadata } from '../types/kitchen';

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // Keep tombstones 30 days

/**
 * Removes tombstone entries older than 30 days so sync metadata stays tiny.
 */
export function pruneTombstones(
  deletedIds?: Record<string, string>,
  nowMs = Date.now()
): Record<string, string> {
  if (!deletedIds) return {};
  const cutoff = nowMs - TOMBSTONE_TTL_MS;
  const pruned: Record<string, string> = {};
  for (const [id, iso] of Object.entries(deletedIds)) {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts) || ts >= cutoff) {
      pruned[id] = iso;
    }
  }
  return pruned;
}

/**
 * Adds one or more deleted entity IDs with a deletion timestamp.
 */
export function recordTombstones(
  syncMeta: SyncMetadata | undefined,
  ids: string[],
  nowIso = new Date().toISOString()
): SyncMetadata {
  const nextDeleted = pruneTombstones(syncMeta?.deletedIds);
  for (const id of ids) {
    if (id) nextDeleted[id] = nowIso;
  }
  return {
    ...syncMeta,
    deletedIds: nextDeleted,
  };
}

/**
 * Removes an entity ID from tombstones (e.g. when the user taps Undo after a delete).
 */
export function clearTombstones(
  syncMeta: SyncMetadata | undefined,
  ids: string[]
): SyncMetadata {
  const nextDeleted = { ...(syncMeta?.deletedIds || {}) };
  for (const id of ids) {
    delete nextDeleted[id];
  }
  return {
    ...syncMeta,
    deletedIds: nextDeleted,
  };
}

function getTimestampMs(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

interface EntityWithId {
  id: string;
  updatedAt?: string;
}

function mergeEntityList<T extends EntityWithId>(
  localList: T[],
  remoteList: T[],
  mergedDeleted: Record<string, string>,
  fallbackTs: (item: T) => string | undefined,
  preferRemoteOnTie: boolean
): T[] {
  const localMap = new Map(localList.map((e) => [e.id, e]));
  const remoteMap = new Map(remoteList.map((e) => [e.id, e]));

  // Preserve intuitive ordering: remote order first if preferring remote, else local order first
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const primary = preferRemoteOnTie ? remoteList : localList;
  const secondary = preferRemoteOnTie ? localList : remoteList;

  for (const item of primary) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      orderedIds.push(item.id);
    }
  }
  for (const item of secondary) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      orderedIds.push(item.id);
    }
  }

  const result: T[] = [];
  for (const id of orderedIds) {
    const loc = localMap.get(id);
    const rem = remoteMap.get(id);
    const delMs = getTimestampMs(mergedDeleted[id]);

    let winner: T | undefined;
    if (loc && rem) {
      const locMs = getTimestampMs(loc.updatedAt ?? fallbackTs(loc));
      const remMs = getTimestampMs(rem.updatedAt ?? fallbackTs(rem));
      if (locMs > remMs) winner = loc;
      else if (remMs > locMs) winner = rem;
      else winner = preferRemoteOnTie ? rem : loc;
    } else {
      winner = loc ?? rem;
    }

    if (!winner) continue;
    const winnerMs = getTimestampMs(winner.updatedAt ?? fallbackTs(winner));
    // If deleted AFTER this entity's last update, respect the deletion
    if (delMs > 0 && delMs >= winnerMs) {
      continue;
    }
    result.push(winner);
  }

  return result;
}

/**
 * Merges local and remote KitchenState at the entity level using per-entity `updatedAt`
 * timestamps and deletion tombstones. Prevents offline or concurrent edits from silently
 * overwriting a partner's changes.
 */
export function mergeKitchenStates(
  local: KitchenState,
  remote: KitchenState,
  options: { preferRemoteOnTie?: boolean } = {}
): KitchenState {
  const preferRemoteOnTie = options.preferRemoteOnTie ?? true;

  // Merge deletion tombstones (keep newest deletion timestamp per entity)
  const rawDeleted: Record<string, string> = {};
  for (const [id, ts] of Object.entries(remote.syncMeta?.deletedIds || {})) {
    rawDeleted[id] = ts;
  }
  for (const [id, ts] of Object.entries(local.syncMeta?.deletedIds || {})) {
    if (!rawDeleted[id] || getTimestampMs(ts) > getTimestampMs(rawDeleted[id])) {
      rawDeleted[id] = ts;
    }
  }
  const mergedDeleted = pruneTombstones(rawDeleted);

  const items = mergeEntityList(
    local.items || [],
    remote.items || [],
    mergedDeleted,
    (i) => i.lastUsedAt ?? i.lastRestockedAt,
    preferRemoteOnTie
  );

  const stores = mergeEntityList(
    local.stores || [],
    remote.stores || [],
    mergedDeleted,
    () => undefined,
    preferRemoteOnTie
  );

  const shoppingList = mergeEntityList(
    local.shoppingList || [],
    remote.shoppingList || [],
    mergedDeleted,
    (s) => s.addedAt,
    preferRemoteOnTie
  );

  const recipes = mergeEntityList(
    local.recipes || [],
    remote.recipes || [],
    mergedDeleted,
    () => undefined,
    preferRemoteOnTie
  );

  const weeklyPlan = mergeEntityList(
    local.weeklyPlan || [],
    remote.weeklyPlan || [],
    mergedDeleted,
    () => undefined,
    preferRemoteOnTie
  );

  // Merge events by ID, newest first, capped at 200
  const eventMap = new Map<string, KitchenState['events'][number]>();
  for (const ev of remote.events || []) eventMap.set(ev.id, ev);
  for (const ev of local.events || []) eventMap.set(ev.id, ev);
  const events = Array.from(eventMap.values())
    .sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp))
    .slice(0, 200);

  // Merge tripReceipts by ID, newest first, capped at 100
  const receiptMap = new Map<string, NonNullable<KitchenState['tripReceipts']>[number]>();
  for (const r of remote.tripReceipts || []) receiptMap.set(r.id, r);
  for (const r of local.tripReceipts || []) receiptMap.set(r.id, r);
  const tripReceipts = Array.from(receiptMap.values())
    .sort((a, b) => getTimestampMs(b.date) - getTimestampMs(a.date))
    .slice(0, 100);

  // Merge settings by settingsUpdatedAt
  const localSettingsMs = getTimestampMs(local.syncMeta?.settingsUpdatedAt);
  const remoteSettingsMs = getTimestampMs(remote.syncMeta?.settingsUpdatedAt);
  const useLocalSettings =
    localSettingsMs > remoteSettingsMs ||
    (localSettingsMs === remoteSettingsMs && !preferRemoteOnTie);
  const settings = useLocalSettings ? local.settings : remote.settings;
  const settingsUpdatedAt =
    localSettingsMs >= remoteSettingsMs
      ? local.syncMeta?.settingsUpdatedAt ?? remote.syncMeta?.settingsUpdatedAt
      : remote.syncMeta?.settingsUpdatedAt ?? local.syncMeta?.settingsUpdatedAt;

  return {
    items,
    stores: stores.length > 0 ? stores : remote.stores || local.stores,
    shoppingList,
    events,
    recipes,
    weeklyPlan,
    tripReceipts,
    settings,
    syncMeta: {
      deletedIds: mergedDeleted,
      settingsUpdatedAt,
    },
  };
}
