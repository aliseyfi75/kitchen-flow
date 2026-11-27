import { KitchenState } from '../types/kitchen';
import { createCleanState, stripLegacyDemoData } from '../data/seedData';

const STORAGE_KEY = 'kitchenflow_prod_v1';

export interface KitchenRepository {
  load(): KitchenState;
  save(state: KitchenState): void;
}

export class LocalStorageKitchenRepository implements KitchenRepository {
  load(): KitchenState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = createCleanState();
        this.save(fresh);
        return fresh;
      }
      const parsed = JSON.parse(raw) as KitchenState;
      const defaults = createCleanState();
      if (!parsed.items || !parsed.stores || !parsed.settings) {
        this.save(defaults);
        return defaults;
      }
      const merged: KitchenState = {
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
      return stripLegacyDemoData(merged).cleaned;
    } catch {
      const fresh = createCleanState();
      this.save(fresh);
      return fresh;
    }
  }

  save(state: KitchenState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors in private browsing
    }
  }
}

export const kitchenRepo: KitchenRepository = new LocalStorageKitchenRepository();
