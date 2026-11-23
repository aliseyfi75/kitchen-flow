import React, { useState } from 'react';
import { Lock, ShieldCheck, Sparkles, X } from 'lucide-react';

interface LoginGateModalProps {
  onClose: () => void;
  onSelectDemoUser: (user: 'Ali' | 'Keemia') => void;
}

export const LoginGateModal: React.FC<LoginGateModalProps> = ({
  onClose,
  onSelectDemoUser,
}) => {
  const [email, setEmail] = useState('ali@household.local');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-stone-200 overflow-hidden">
        <div className="bg-gradient-to-br from-teal-800 to-emerald-700 p-6 text-white relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-bold">KitchenFlow Private Access</h2>
          <p className="text-xs text-teal-100 mt-1">
            Invite-only household login (Public GitHub Pages UI + Private Supabase RLS Backend)
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-2xl bg-teal-50 border border-teal-100 p-3 text-xs text-teal-900 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <div>
              <strong>How Phase 2 Security Works:</strong> Public signups are disabled in Supabase. Only
              your 2 whitelisted household emails can sign in, and Row Level Security blocks all
              unauthenticated reads/writes.
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">
                Household Member Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onSelectDemoUser('Ali');
                  onClose();
                }}
                className="rounded-xl bg-teal-700 hover:bg-teal-800 text-white py-2.5 px-3 text-xs font-bold shadow-xs transition"
              >
                Enter as Ali (Demo)
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectDemoUser('Keemia');
                  onClose();
                }}
                className="rounded-xl bg-stone-900 hover:bg-stone-800 text-white py-2.5 px-3 text-xs font-bold shadow-xs transition"
              >
                Enter as Keemia (Demo)
              </button>
            </div>
          </div>

          <div className="text-[11px] text-stone-400 text-center flex items-center justify-center gap-1 pt-1">
            <Sparkles className="w-3.5 h-3.5 text-teal-600" />
            Ready to wire to Supabase Magic Link / Password Auth in Phase 2
          </div>
        </div>
      </div>
    </div>
  );
};
