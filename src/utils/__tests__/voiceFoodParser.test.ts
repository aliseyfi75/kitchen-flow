import { describe, expect, it } from 'vitest';
import {
  matchVoiceIngredientToKitchen,
  normalizeBilingualText,
  parseVoiceFoodLocally,
} from '../voiceFoodParser';
import { createTourDemoState } from '../../data/tourDemoData';

describe('voiceFoodParser', () => {
  it('normalizes Persian digits, Arabic Yeh/Kaf, and compound phrases cleanly', () => {
    expect(normalizeBilingualText('۳ تا تخم‌مرغ و روغن زیتون')).toContain('تخم_مرغ');
    expect(normalizeBilingualText('۳ تا تخم‌مرغ')).toContain('3');
  });

  it('matches spoken Persian ingredients to English kitchen items without false collisions', () => {
    const demo = createTourDemoState();
    const chickenMatch = matchVoiceIngredientToKitchen('سینه مرغ', '', demo.items);
    expect(chickenMatch?.item.id).toBe('tour-chicken');

    const oilMatch = matchVoiceIngredientToKitchen('روغن زیتون', '', demo.items);
    expect(oilMatch?.item.id).toBe('tour-olive-oil');

    // "تخم مرغ" (eggs) must NOT falsely match "سینه مرغ" (chicken breast)
    const eggMatch = matchVoiceIngredientToKitchen('تخم مرغ', '', demo.items);
    expect(eggMatch?.item.id).not.toBe('tour-chicken');
  });

  it('parses an English voice recipe and links existing kitchen items', () => {
    const demo = createTourDemoState();
    const parsed = parseVoiceFoodLocally(
      'Air fryer salmon bowl with 1 salmon fillet, 1 cup basmati rice, 2 handfuls baby spinach, and 1 tbsp olive oil, 20 minutes',
      demo.items,
      'tour-costco',
      ['Persian', 'Western']
    );

    expect(parsed.tools).toContain('air_fryer');
    expect(parsed.prepMinutes).toBe(20);
    const matchedIds = parsed.ingredients.map((i) => i.matchedItemId).filter(Boolean);
    expect(matchedIds).toContain('tour-salmon');
    expect(matchedIds).toContain('tour-rice');
    expect(matchedIds).toContain('tour-spinach');
  });

  it('parses a Farsi voice recipe with known dish title and bilingual aliases', () => {
    const demo = createTourDemoState();
    const parsed = parseVoiceFoodLocally(
      'املت اسفناج و قارچ توی تابه، ۱۵ دقیقه: ۳ تا تخم‌مرغ، ۱ مشت اسفناج تازه، ۱۰۰ گرم قارچ و روغن زیتون',
      demo.items,
      'tour-costco',
      ['Persian', 'Western']
    );

    expect(parsed.tools).toContain('pan');
    expect(parsed.prepMinutes).toBe(15);
    expect(parsed.ingredients.some((i) => i.matchedItemId === 'tour-spinach')).toBe(true);
    expect(parsed.ingredients.some((i) => i.matchedItemId === 'tour-olive-oil')).toBe(true);
  });
});
