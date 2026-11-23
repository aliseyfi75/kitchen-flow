import React, { useEffect, useMemo, useState } from 'react';
import {
  ChefHat,
  Cloud,
  CloudOff,
  Layers,
  Loader2,
  LogOut,
  Refrigerator,
  Settings,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';
import { useSupabaseAuth } from './hooks/useSupabaseAuth';
import { useKitchenStore } from './hooks/useKitchenStore';
import { t } from './i18n/translations';
import { KitchenView } from './components/KitchenView';
import { ShoppingView } from './components/ShoppingView';
import { MealPlannerView } from './components/MealPlannerView';
import { SettingsView } from './components/SettingsView';
import { AuthGate } from './components/AuthGate';
import { ReceiptScanModal } from './components/ReceiptScanModal';

type TabId = 'kitchen' | 'shopping' | 'meals' | 'settings';

export function App() {
  const auth = useSupabaseAuth();

  const cloudContext = useMemo(() => {
    if (auth.mode === 'cloud' && auth.member) {
      return {
        householdId: auth.member.householdId,
        displayName: auth.member.displayName,
      };
    }
    return null;
  }, [auth.mode, auth.member]);

  const store = useKitchenStore(cloudContext);
  const { state, toast, syncStatus } = store;
  const lang = 'en' as const;
  const uiMode = state.settings.uiMode;

  const [activeTab, setActiveTab] = useState<TabId>('kitchen');
  const [showReceiptScanner, setShowReceiptScanner] = useState(false);

  useEffect(() => {
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
  }, []);

  if (auth.mode === 'cloud' && (auth.loading || !auth.session || !auth.member)) {
    return (
      <AuthGate
        loading={auth.loading}
        membershipError={auth.membershipError}
        signedInEmail={auth.session?.user?.email}
        onSignIn={auth.signIn}
        onSignOut={auth.signOut}
      />
    );
  }

  const activeDisplayName = auth.member?.displayName || state.settings.activeUser;

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
    <div className="min-h-screen bg-[#FAF9F6] text-stone-900 pb-24 lg:pb-10">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-[#FAF9F6]/90 backdrop-blur-md border-b border-stone-200/80">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center shadow-xs font-bold shrink-0">
              KF
            </div>
            <div className="min-w-0 flex items-center gap-2">
              <h1 className="font-bold text-base sm:text-lg tracking-tight text-stone-900 whitespace-nowrap">
                {t(lang, 'appName')}
              </h1>
              {auth.mode === 'cloud' && (
                <span
                  className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    syncStatus === 'synced'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : syncStatus === 'saving' || syncStatus === 'loading'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}
                  title="Real-time household cloud sync status"
                >
                  {syncStatus === 'synced' ? (
                    <Cloud className="w-3 h-3" />
                  ) : syncStatus === 'offline' ? (
                    <CloudOff className="w-3 h-3" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {syncStatus === 'synced'
                    ? 'Synced'
                    : syncStatus === 'offline'
                    ? 'Offline'
                    : 'Syncing'}
                </span>
              )}
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

          {/* Header Controls: Simple / Detailed Toggle + Sign Out */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="inline-flex items-center rounded-xl border border-stone-200 bg-white p-0.5 shadow-2xs"
              role="group"
              aria-label="Simple or Detailed view mode"
            >
              <button
                type="button"
                onClick={() => store.updateSettings({ uiMode: 'simple' })}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${
                  uiMode === 'simple'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
                title="Simple mode — quick everyday logging"
              >
                <Sparkles className="w-3 h-3" />
                {t(lang, 'simpleMode')}
              </button>
              <button
                type="button"
                onClick={() => store.updateSettings({ uiMode: 'detailed' })}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${
                  uiMode === 'detailed'
                    ? 'bg-stone-900 text-white shadow-2xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
                title="Detailed mode — nutrition facts, micronutrients & label scanner"
              >
                <Layers className="w-3 h-3" />
                {t(lang, 'detailedMode')}
              </button>
            </div>

            {auth.mode === 'cloud' && (
              <button
                type="button"
                onClick={() => auth.signOut()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-stone-700 transition"
                title={`Signed in as ${activeDisplayName} — Click to sign out`}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{activeDisplayName}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-5">
        {activeTab === 'kitchen' && (
          <KitchenView
            items={state.items}
            stores={state.stores}
            shoppingList={state.shoppingList}
            shoppingDay={state.settings.shoppingDay}
            lang={lang}
            uiMode={uiMode}
            eatingMode={state.settings.eatingMode}
            guestCount={state.settings.guestCount}
            onChangeEatingMode={(eatingMode, guestCount) =>
              store.updateSettings({
                eatingMode,
                ...(guestCount !== undefined ? { guestCount } : {}),
              })
            }
            onUsePortion={store.usePortion}
            onSetLevel={store.setContinuousLevel}
            onMarkFinished={store.markFinished}
            onQuickRestock={store.quickRestock}
            onAddToShoppingManually={store.addKitchenItemToShoppingManually}
            onSaveItem={store.saveItem}
            onDeleteItem={store.deleteItem}
            onOpenReceiptScanner={() => setShowReceiptScanner(true)}
          />
        )}

        {activeTab === 'shopping' && (
          <ShoppingView
            items={state.items}
            stores={state.stores}
            shoppingList={state.shoppingList}
            shoppingDay={state.settings.shoppingDay}
            forecastHorizonDays={state.settings.forecastHorizonDays}
            lang={lang}
            uiMode={uiMode}
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
            stores={state.stores}
            recipes={state.recipes}
            weeklyPlan={state.weeklyPlan}
            cuisines={state.settings.cuisines}
            defaultTools={state.settings.defaultTools}
            dailyProteinTarget={state.settings.dailyProteinTarget}
            dailySugarLimit={state.settings.dailySugarLimit}
            shoppingDay={state.settings.shoppingDay}
            lang={lang}
            uiMode={uiMode}
            onSetWeeklyPlan={store.setWeeklyPlan}
            onUpdateMealServings={store.updatePlannedMealServings}
            onMarkMealCooked={store.markMealCooked}
            onCookRecipeDirect={store.cookRecipeDirect}
            onAddRecipe={store.addRecipe}
            onAddCuisine={store.addCuisine}
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
            onUpdateItemLearning={store.updateItemLearning}
            onAddStore={store.addStore}
            onUpdateStore={store.updateStore}
            onDeleteStore={store.deleteStore}
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

      {showReceiptScanner && (
        <ReceiptScanModal
          items={state.items}
          stores={state.stores}
          lang={lang}
          onClose={() => setShowReceiptScanner(false)}
          onApplyReceipt={store.applyReceiptItems}
        />
      )}
    </div>
  );
}

export default App;
