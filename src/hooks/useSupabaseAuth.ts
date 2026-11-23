import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';

export interface HouseholdMember {
  userId: string;
  householdId: string;
  displayName: string;
  email: string;
}

export interface AuthState {
  mode: 'local_demo' | 'cloud';
  loading: boolean;
  session: Session | null;
  member: HouseholdMember | null;
  membershipError: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export function useSupabaseAuth(): AuthState {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<HouseholdMember | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);

  const loadMembership = useCallback(async (activeSession: Session | null) => {
    if (!supabase || !activeSession?.user) {
      setMember(null);
      setMembershipError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('household_members')
      .select('household_id, display_name')
      .eq('user_id', activeSession.user.id)
      .maybeSingle();

    if (error) {
      setMember(null);
      setMembershipError(
        `Could not verify household access (${error.message}). Make sure you ran supabase/schema.sql.`
      );
    } else if (!data) {
      setMember(null);
      setMembershipError(
        'This account is not linked to the household yet. Run the 2-user linking block at the bottom of supabase/schema.sql.'
      );
    } else {
      setMember({
        userId: activeSession.user.id,
        householdId: data.household_id,
        displayName: data.display_name || activeSession.user.email?.split('@')[0] || 'Member',
        email: activeSession.user.email || '',
      });
      setMembershipError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      loadMembership(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      loadMembership(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadMembership]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    if (!supabase) return 'Supabase is not configured.';
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return error.message;
    return null;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMember(null);
    setSession(null);
  }, []);

  return {
    mode: isSupabaseConfigured ? 'cloud' : 'local_demo',
    loading,
    session,
    member,
    membershipError,
    signIn,
    signOut,
  };
}
