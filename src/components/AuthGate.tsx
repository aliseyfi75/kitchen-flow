import React, { useState } from 'react';
import { Loader2, Lock, LogOut, ShieldCheck } from 'lucide-react';

interface AuthGateProps {
  loading: boolean;
  membershipError: string | null;
  signedInEmail?: string | null;
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignOut: () => Promise<void>;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  loading,
  membershipError,
  signedInEmail,
  onSignIn,
  onSignOut,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setErrorMsg(null);
    const err = await onSignIn(email, password);
    setSubmitting(false);
    if (err) setErrorMsg(err);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-teal-700 text-white font-bold flex items-center justify-center mx-auto shadow-sm">
            KF
          </div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600">
            <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
            Connecting to your kitchen...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-xl border border-stone-200 overflow-hidden">
        <div className="bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-700 p-6 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center font-bold text-lg">
              KF
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">KitchenFlow</h1>
              <p className="text-xs text-teal-100">Private Household Access</p>
            </div>
          </div>
          <p className="text-xs text-teal-100/90 leading-relaxed">
            Invite-only sign-in for your shared kitchen inventory, weekend shopping list, and meal planner.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {membershipError ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 space-y-1.5">
                <div className="font-bold">Account Not Authorized</div>
                <p>{membershipError}</p>
                {signedInEmail && (
                  <p className="text-[11px] text-amber-700">Signed in as: {signedInEmail}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white py-2.5 text-sm font-semibold"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMsg && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-800">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Email</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Password</label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white py-3 text-sm font-bold shadow-xs transition"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                {submitting ? 'Signing in...' : 'Sign In to Kitchen'}
              </button>

              <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3 flex items-start gap-2 text-[11px] text-stone-600">
                <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <span>
                  Public signups are disabled. Only authorized household members can sign in and sync data.
                </span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
