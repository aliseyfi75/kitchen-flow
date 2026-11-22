import { KitchenState } from '../types/kitchen';
import { createSeedState } from '../data/seedData';

const STORAGE_KEY = 'kitchenflow_state_v1';

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
      if (!parsed.items || !parsed.stores || !parsed.settings) {
        const seed = createSeedState();
        this.save(seed);
        return seed;
      }
      return parsed;
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
