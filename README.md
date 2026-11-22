# KitchenFlow

Smart household food inventory, portion tracker, consumption forecaster, store-aware weekend shopping planner, and protein-focused hybrid meal planner — built for shared 2-person household use with full English & Persian bilingual support.

## Features (Phase 1 Prototype)
- **Kitchen Inventory & Portioning**: Track Freezer, Fridge, and Pantry items with bilingual primary names + secondary aliases (e.g., `Chicken Breast` / `سینه مرغ`), 1-tap `-1 Portion`, quick level bar for continuous items, and 1-tap `Finished → Add to Shopping List`.
- **EMA Consumption Learning & Weekend Forecasting**: Learns household consumption velocity from real usage events and projects whether each staple is **Buy This Weekend**, **Borderline**, or **Good Until Next Week**.
- **Store-Aware Weekend Shopping Planner**: Automatically learns store affinity (Costco, Superstore, Persian Market, etc.), summarizes which stores you need to visit this weekend, and supports 1-tap **Complete Trip → Restock & Portion**.
- **Hybrid Meal & Protein-Max Planner**: Selectable cooking tools (Air Fryer, Oven, Pan/Stovetop defaults + extras), selectable inventory ingredients (prioritize / exclude), daily protein target, effort level, personal favorite meals library, and Gemini AI edge-function integration architecture.
- **Bilingual EN / FA Support**: First-class mixed-language rendering (`dir="auto"`, Inter + Vazirmatn) plus optional instant EN/FA UI toggle.

## Local Development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```
