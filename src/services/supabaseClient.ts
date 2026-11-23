import { createClient, SupabaseClient } from '@supabase/supabase-js';

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const KEEP_SIGNED_IN_KEY = 'kitchenflow_keep_signed_in';

export function getKeepSignedInPreference(): boolean {
  try {
    return localStorage.getItem(KEEP_SIGNED_IN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setKeepSignedInPreference(keep: boolean): void {
  try {
    localStorage.setItem(KEEP_SIGNED_IN_KEY, keep ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

/**
 * Adaptive auth storage:
 * - "Keep me signed in" ON (default): persists session in localStorage across restarts & PWA launches.
 * - "Keep me signed in" OFF: stores session only in sessionStorage (clears when tab/window closes).
 */
const adaptiveAuthStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key) ?? sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (getKeepSignedInPreference()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      // ignore storage quota errors
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('YOUR_PROJECT_REF') &&
    !supabaseAnonKey.includes('YOUR_PUBLIC_SUPABASE_ANON_KEY')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: adaptiveAuthStorage,
      },
    })
  : null;
