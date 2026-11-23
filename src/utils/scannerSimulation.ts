import { InventoryItem } from '../types/kitchen';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2);
}

/**
 * Matches a receipt line against existing kitchen inventory using EN/FA token overlap.
 */
export function matchInventoryItem(
  candidateName: string,
  candidateAlias: string,
  items: InventoryItem[]
): { item: InventoryItem; confidence: 'high' | 'medium' } | null {
  const candTokens = new Set([...tokenize(candidateName), ...tokenize(candidateAlias)]);
  if (candTokens.size === 0) return null;

  let best: InventoryItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    const itemTokens = [...tokenize(item.name), ...tokenize(item.alias)];
    let overlap = 0;
    for (const tok of itemTokens) {
      if (candTokens.has(tok)) overlap += 1;
    }
    const ratio = overlap / Math.max(1, Math.min(candTokens.size, itemTokens.length));
    if (ratio > bestScore) {
      bestScore = ratio;
      best = item;
    }
  }

  if (best && bestScore >= 0.6) {
    return { item: best, confidence: bestScore >= 0.85 ? 'high' : 'medium' };
  }
  return null;
}
