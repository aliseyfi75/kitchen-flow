import React, { useEffect, useState } from 'react';
import {
  ChefHat,
  Globe,
  Lock,
  Refrigerator,
  Settings,
  ShoppingCart,
} from 'lucide-react';
import { useKitchenStore } from './hooks/useKitchenStore';
import { t } from './i18n/translations';
import { KitchenView } from './components/KitchenView';
import { ShoppingView } from './components/ShoppingView';
import { MealPlannerView } from './components/MealPlannerView';
import { SettingsView } from './components/SettingsView';
import { LoginGateModal } from './components/LoginGateModal';

type TabId = 'kitchen' | 'shopping' | 'meals' | 'settings';

export function App() {
  const store = useKitchenStore();
  const { state, toast } = store;
  const lang = state.settings.language;

  const [activeTab, setActiveTab] = useState<TabId>('kitchen');
  const [showLoginPreview, setShowLoginPreview] = useState(false);

  useEffect(() => {
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const essentialShoppingCount = state.shoppingList.filter(
    (s) => s.priority === 'essential' && !s.checked
  ).length;

  const navItems: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'kitchen', label: t(lang, 'navKitchen'), icon: <Refrigerator className="w-5 h-5" /> },
    {
      id: 'shopping',
      label: t(lang, 'navShopping'),
      icon: <ShoppingCart className="w-5 h-5" />,
      badge: essentialShoppingCount > 0 ? essentialShoppingCount : undefined,
    },
    { id: 'meals', label: t(lang, 'navMeals'), icon: <ChefHat className="w-5 h-5" /> },
    { id: 'settings', label: t(lang, 'navInsights'), icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-stone-900 pb-24 sm:pb-10">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-[#FAF9F6]/90 backdrop-blur-md border-b border-stone-200/80">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center shadow-xs font-bold">
              KF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base sm:text-lg tracking-tight text-stone-900 whitespace-nowrap">
                  {t(lang, 'appName')}
                </h1>
                <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-teal-100 text-teal-800 whitespace-nowrap">
                  {t(lang, 'demoMode')}
                </span>
              </div>
              <p className="text-[11px] text-stone-500 hidden lg:block whitespace-nowrap">
                {t(lang, 'tagline')}
              </p>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1 bg-white border border-stone-200/80 p-1 rounded-2xl shadow-2xs shrink-0">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                    active
                      ? 'bg-teal-700 text-white shadow-2xs'
                      : 'text-stone-600 hover:bg-stone-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        active ? 'bg-white text-teal-900' : 'bg-amber-500 text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Header Controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                store.updateSettings({ language: lang === 'en' ? 'fa' : 'en' })
              }
              className="inline-flex items-center gap-1 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 px-2.5 py-1.5 text-xs font-semibold text-stone-700"
              title="Toggle English / Persian UI"
            >
              <Globe className="w-3.5 h-3.5 text-teal-700" />
              {lang === 'en' ? 'فا' : 'EN'}
            </button>

            <button
              type="button"
              onClick={() => setShowLoginPreview(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 px-2.5 py-1.5 text-xs font-semibold text-stone-700"
              title="Preview 2-user private login gate"
            >
              <Lock className="w-3.5 h-3.5 text-teal-700" />
              <span className="hidden sm:inline">{state.settings.activeUser}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-5">
        {activeTab === 'kitchen' && (
          <KitchenView
            items={state.items}
            stores={state.stores}
            shoppingDay={state.settings.shoppingDay}
            lang={lang}
            onUsePortion={store.usePortion}
            onSetLevel={store.setContinuousLevel}
            onMarkFinished={store.markFinished}
            onQuickRestock={store.quickRestock}
            onSaveItem={store.saveItem}
            onDeleteItem={store.deleteItem}
          />
        )}

        {activeTab === 'shopping' && (
          <ShoppingView
            items={state.items}
            stores={state.stores}
            shoppingList={state.shoppingList}
            shoppingDay={state.settings.shoppingDay}
            lang={lang}
            onSyncForecast={store.syncForecastToShoppingList}
            onAddShoppingItem={store.addShoppingItem}
            onToggleChecked={store.toggleShoppingChecked}
            onUpdateShoppingItem={store.updateShoppingItem}
            onRemoveShoppingItem={store.removeShoppingItem}
            onCompleteTrip={store.completeShoppingTrip}
          />
        )}

        {activeTab === 'meals' && (
          <MealPlannerView
            items={state.items}
            recipes={state.recipes}
            weeklyPlan={state.weeklyPlan}
            defaultTools={state.settings.defaultTools}
            dailyProteinTarget={state.settings.dailyProteinTarget}
            shoppingDay={state.settings.shoppingDay}
            lang={lang}
            onSetWeeklyPlan={store.setWeeklyPlan}
            onMarkMealCooked={store.markMealCooked}
            onAddRecipe={store.addRecipe}
            onToggleFavorite={store.toggleFavoriteRecipe}
            onAddMissingToShopping={store.addShoppingItem}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            items={state.items}
            stores={state.stores}
            settings={state.settings}
            onUpdateSettings={store.updateSettings}
            onAddStore={store.addStore}
            onDeleteStore={store.deleteStore}
            onResetDemo={store.resetDemo}
            onOpenLoginPreview={() => setShowLoginPreview(true)}
          />
        )}
      </main>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-md pointer-events-none">
          <div
            className={`rounded-2xl px-4 py-3 text-xs sm:text-sm font-semibold text-white shadow-xl text-center ${
              toast.tone === 'amber'
                ? 'bg-amber-600'
                : toast.tone === 'rose'
                ? 'bg-rose-600'
                : 'bg-stone-900'
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}

      {/* Mobile & Tablet Bottom Tab Navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200 safe-bottom">
        <div className="grid grid-cols-4 h-16">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                  active ? 'text-teal-700' : 'text-stone-500'
                }`}
              >
                <div className="relative">
                  {item.icon}
                  {item.badge !== undefined && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {showLoginPreview && (
        <LoginGateModal
          onClose={() => setShowLoginPreview(false)}
          onSelectDemoUser={(user) => {
            store.updateSettings({ activeUser: user });
            store.notify(`Signed in as ${user} (Local Demo)`, 'teal');
          }}
        />
      )}
    </div>
  );
}

export default App;
