import { KitchenState } from '../types/kitchen';
import { createSeedState } from '../data/seedData';

const STORAGE_KEY = 'kitchenflow_state_v3';

/**
 * Repository abstraction so Phase 2 can swap LocalStorageKitchenRepository
 * with SupabaseKitchenRepository (Postgres + Realtime + RLS) cleanly.
 */
export interface KitchenRepository {
  load(): KitchenState;
  save(state: KitchenState): void;
  reset(): KitchenState;
}

export class LocalStorageKitchenRepository implements KitchenRepository {
  load(): KitchenState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seed = createSeedState();
        this.save(seed);
        return seed;
      }
      const parsed = JSON.parse(raw) as KitchenState;
      const defaults = createSeedState();
      if (!parsed.items || !parsed.stores || !parsed.settings) {
        this.save(defaults);
        return defaults;
      }
      // Graceful forward-compatibility merge for new settings/fields
      return {
        ...defaults,
        ...parsed,
        settings: {
          ...defaults.settings,
          ...parsed.settings,
        },
        weeklyPlan: (parsed.weeklyPlan || []).map((m) => ({
          ...m,
          servings: m.servings ?? (m.slot === 'lunch' ? 1 : 2),
        })),
      };
    } catch {
      const seed = createSeedState();
      this.save(seed);
      return seed;
    }
  }

  save(state: KitchenState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors in private browsing
    }
  }

  reset(): KitchenState {
    const seed = createSeedState();
    this.save(seed);
    return seed;
  }
}

export const kitchenRepo: KitchenRepository = new LocalStorageKitchenRepository();
