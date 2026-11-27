import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
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
import { UI_LABELS } from './i18n/translations';
import { KitchenView } from './components/KitchenView';
import { AuthGate } from './components/AuthGate';
import { FeatureTour, TOUR_STEPS } from './components/FeatureTour';
import { createTourDemoState } from './data/tourDemoData';

const ShoppingView = lazy(() =>
  import('./components/ShoppingView').then((m) => ({ default: m.ShoppingView }))
);
const MealPlannerView = lazy(() =>
  import('./components/MealPlannerView').then((m) => ({ default: m.MealPlannerView }))
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const ReceiptScanModal = lazy(() =>
  import('./components/ReceiptScanModal').then((m) => ({ default: m.ReceiptScanModal }))
);

type TabId = 'kitchen' | 'shopping' | 'meals' | 'settings';

const TOUR_SEEN_KEY = 'kitchenflow_tour_seen_v1';

function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, 'true');
  } catch {
    // ignore storage errors
  }
}

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
  const { state: realState, toast, syncStatus } = store;

  const [activeTab, setActiveTab] = useState<TabId>('kitchen');
  const [showReceiptScanner, setShowReceiptScanner] = useState(false);

  // Interactive Guided Tour (uses completely isolated in-memory sample data — never modifies real data)
  const [tourStep, setTourStep] = useState<number | null>(null);
  const tourState = useMemo(() => createTourDemoState(), [tourStep !== null]);

  const isAuthenticatedOrLocal =
    auth.mode === 'local_demo' || (!auth.loading && Boolean(auth.session) && Boolean(auth.member));

  // Auto-start tour once for first-time users right after signing in
  useEffect(() => {
    if (isAuthenticatedOrLocal && !hasSeenTour()) {
      setTourStep(0);
    }
  }, [isAuthenticatedOrLocal]);

  // Keep active tab synced with the current tour step and scroll gently to top
  useEffect(() => {
    if (tourStep !== null) {
      const def = TOUR_STEPS[tourStep];
      if (def) {
        setActiveTab(def.tab);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [tourStep]);

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

  const isTourActive = tourStep !== null;
  const activeState = isTourActive ? tourState : realState;
  const uiMode = isTourActive ? TOUR_STEPS[tourStep].uiMode : realState.settings.uiMode;
  const activeDisplayName = auth.member?.displayName || realState.settings.activeUser;

  const startTour = () => {
    setTourStep(0);
  };

  const finishTour = () => {
    markTourSeen();
    setTourStep(null);
    setActiveTab('kitchen');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const tourReadOnlyNotice = () => {
    store.notify('You are viewing sample tour data — exit the tour to edit your real kitchen.', 'amber');
  };

  const essentialShoppingCount = activeState.shoppingList.filter(
    (s) => s.priority === 'essential' && !s.checked
  ).length;

  const navItems: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'kitchen', label: UI_LABELS.navKitchen, icon: <Refrigerator className="w-5 h-5" /> },
    {
      id: 'shopping',
      label: UI_LABELS.navShopping,
      icon: <ShoppingCart className="w-5 h-5" />,
      badge: essentialShoppingCount > 0 ? essentialShoppingCount : undefined,
    },
    { id: 'meals', label: UI_LABELS.navMeals, icon: <ChefHat className="w-5 h-5" /> },
    { id: 'settings', label: UI_LABELS.navInsights, icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div
      className={`min-h-[100dvh] bg-[#FAF9F6] text-stone-900 ${
        isTourActive ? 'pb-72 lg:pb-16' : 'pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-10'
      }`}
    >
      {/* Top Header with iPhone Notch / Dynamic Island Safe-Area Support */}
      <header className="sticky top-0 z-30 bg-[#FAF9F6]/92 backdrop-blur-md border-b border-stone-200/80 safe-top">
        <div className="max-w-5xl mx-auto safe-x h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center shadow-xs font-bold text-xs sm:text-sm shrink-0">
              KF
            </div>
            <div className="min-w-0 flex items-center gap-1.5 sm:gap-2">
              <h1 className="font-bold text-sm sm:text-lg tracking-tight text-stone-900 whitespace-nowrap">
                {UI_LABELS.appName}
              </h1>
              {auth.mode === 'cloud' && (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-bold ${
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
                  <span className="hidden sm:inline">
                    {syncStatus === 'synced'
                      ? 'Synced'
                      : syncStatus === 'offline'
                      ? 'Offline'
                      : 'Syncing'}
                  </span>
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
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <div
              className="inline-flex items-center rounded-xl border border-stone-200 bg-white p-0.5 shadow-2xs"
              role="group"
              aria-label="Simple or Detailed view mode"
            >
              <button
                type="button"
                onClick={() =>
                  isTourActive ? tourReadOnlyNotice() : store.updateSettings({ uiMode: 'simple' })
                }
                className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${
                  uiMode === 'simple'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
                title="Simple mode — quick everyday logging"
              >
                <Sparkles className="w-3 h-3 hidden xs:inline" />
                {UI_LABELS.simpleMode}
              </button>
              <button
                type="button"
                onClick={() =>
                  isTourActive ? tourReadOnlyNotice() : store.updateSettings({ uiMode: 'detailed' })
                }
                className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${
                  uiMode === 'detailed'
                    ? 'bg-stone-900 text-white shadow-2xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
                title="Detailed mode — nutrition facts, micronutrients & label scanner"
              >
                <Layers className="w-3 h-3 hidden xs:inline" />
                {UI_LABELS.detailedMode}
              </button>
            </div>

            {auth.mode === 'cloud' && (
              <button
                type="button"
                onClick={() => auth.signOut()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 px-2 sm:px-2.5 py-1.5 text-xs font-semibold text-stone-700 transition"
                title={`Signed in as ${activeDisplayName} — Click to sign out`}
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{activeDisplayName}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Interactive Feature Tour Banner & Floating Guide Card */}
      {isTourActive && (
        <FeatureTour
          stepIndex={tourStep}
          onChangeStep={setTourStep}
          onFinish={finishTour}
        />
      )}

      {/* Main Content */}
      <main className="max-w-5xl mx-auto safe-x py-4 sm:py-5">
        {activeTab === 'kitchen' && (
          <KitchenView
            items={activeState.items}
            stores={activeState.stores}
            shoppingList={activeState.shoppingList}
            shoppingDay={activeState.settings.shoppingDay}
            uiMode={uiMode}
            eatingMode={activeState.settings.eatingMode}
            guestCount={activeState.settings.guestCount}
            onChangeEatingMode={(eatingMode, guestCount) =>
              isTourActive
                ? tourReadOnlyNotice()
                : store.updateSettings({
                    eatingMode,
                    ...(guestCount !== undefined ? { guestCount } : {}),
                  })
            }
            onUsePortion={isTourActive ? tourReadOnlyNotice : store.usePortion}
            onSetLevel={isTourActive ? tourReadOnlyNotice : store.setContinuousLevel}
            onMarkFinished={isTourActive ? tourReadOnlyNotice : store.markFinished}
            onQuickRestock={isTourActive ? tourReadOnlyNotice : store.quickRestock}
            onAddToShoppingManually={
              isTourActive ? tourReadOnlyNotice : store.addKitchenItemToShoppingManually
            }
            onSaveItem={isTourActive ? tourReadOnlyNotice : store.saveItem}
            onAddItemsBatch={isTourActive ? tourReadOnlyNotice : store.addItemsBatch}
            onApplyVoiceUpdates={
              isTourActive ? tourReadOnlyNotice : store.applyVoiceInventoryUpdates
            }
            onDeleteItem={isTourActive ? tourReadOnlyNotice : store.deleteItem}
            onOpenReceiptScanner={() =>
              isTourActive ? tourReadOnlyNotice() : setShowReceiptScanner(true)
            }
            onOpenShoppingTab={() => setActiveTab('shopping')}
          />
        )}

        <Suspense
          fallback={
            <div className="py-16 flex items-center justify-center text-stone-400 text-xs font-semibold gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
              Loading view...
            </div>
          }
        >
          {activeTab === 'shopping' && (
            <ShoppingView
              items={activeState.items}
              stores={activeState.stores}
              shoppingList={activeState.shoppingList}
              shoppingDay={activeState.settings.shoppingDay}
              forecastHorizonDays={activeState.settings.forecastHorizonDays}
              uiMode={uiMode}
              onSyncForecast={isTourActive ? tourReadOnlyNotice : store.syncForecastToShoppingList}
              onAddShoppingItem={isTourActive ? tourReadOnlyNotice : store.addShoppingItem}
              onToggleChecked={isTourActive ? tourReadOnlyNotice : store.toggleShoppingChecked}
              onUpdateShoppingItem={isTourActive ? tourReadOnlyNotice : store.updateShoppingItem}
              onRemoveShoppingItem={isTourActive ? tourReadOnlyNotice : store.removeShoppingItem}
              onCompleteTrip={isTourActive ? tourReadOnlyNotice : store.completeShoppingTrip}
              onNotify={store.notify}
            />
          )}

          {activeTab === 'meals' && (
            <MealPlannerView
              items={activeState.items}
              stores={activeState.stores}
              recipes={activeState.recipes}
              weeklyPlan={activeState.weeklyPlan}
              cuisines={activeState.settings.cuisines}
              defaultTools={activeState.settings.defaultTools}
              dailyProteinTarget={activeState.settings.dailyProteinTarget}
              dailySugarLimit={activeState.settings.dailySugarLimit}
              shoppingDay={activeState.settings.shoppingDay}
              uiMode={uiMode}
              onSetWeeklyPlan={isTourActive ? tourReadOnlyNotice : store.setWeeklyPlan}
              onUpdateMealServings={isTourActive ? tourReadOnlyNotice : store.updatePlannedMealServings}
              onMarkMealCooked={isTourActive ? tourReadOnlyNotice : store.markMealCooked}
              onCookRecipeDirect={isTourActive ? tourReadOnlyNotice : store.cookRecipeDirect}
              onAddRecipe={isTourActive ? tourReadOnlyNotice : store.addRecipe}
              onUpdateRecipe={isTourActive ? tourReadOnlyNotice : store.updateRecipe}
              onDeleteRecipe={isTourActive ? tourReadOnlyNotice : store.deleteRecipe}
              onAddCuisine={isTourActive ? tourReadOnlyNotice : store.addCuisine}
              onToggleFavorite={isTourActive ? tourReadOnlyNotice : store.toggleFavoriteRecipe}
              onAddMissingToShopping={isTourActive ? tourReadOnlyNotice : store.addShoppingItem}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              items={activeState.items}
              stores={activeState.stores}
              settings={activeState.settings}
              onUpdateSettings={isTourActive ? tourReadOnlyNotice : store.updateSettings}
              onUpdateItemLearning={isTourActive ? tourReadOnlyNotice : store.updateItemLearning}
              onAddStore={isTourActive ? tourReadOnlyNotice : store.addStore}
              onUpdateStore={isTourActive ? tourReadOnlyNotice : store.updateStore}
              onDeleteStore={isTourActive ? tourReadOnlyNotice : store.deleteStore}
              onReplayTour={startTour}
            />
          )}
        </Suspense>
      </main>

      {/* Toast Notification with Optional Undo Button */}
      {toast && (
        <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-md pointer-events-none">
          <div
            className={`pointer-events-auto rounded-2xl px-4 py-3 text-xs sm:text-sm font-semibold text-white shadow-xl flex items-center justify-between gap-3 ${
              toast.tone === 'amber'
                ? 'bg-amber-600'
                : toast.tone === 'rose'
                ? 'bg-rose-600'
                : 'bg-stone-900'
            }`}
          >
            <span className={toast.onUndo ? 'text-left flex-1' : 'text-center flex-1'}>
              {toast.text}
            </span>
            {toast.onUndo && (
              <button
                type="button"
                onClick={toast.onUndo}
                className="shrink-0 rounded-xl bg-white/20 hover:bg-white/30 active:scale-95 px-3 py-1 text-xs font-bold text-white transition"
              >
                {toast.undoLabel || 'Undo'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile & Tablet Bottom Tab Navigation with Home Indicator Safe-Area */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200 safe-bottom">
        <div className="grid grid-cols-4 h-16">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition active:scale-95 ${
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
        <Suspense fallback={null}>
          <ReceiptScanModal
            items={realState.items}
            stores={realState.stores}
            onClose={() => setShowReceiptScanner(false)}
            onApplyReceipt={store.applyReceiptItems}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
