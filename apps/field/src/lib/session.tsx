import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface Profile {
  id: string;
  campaign_id: string;
  role: string;
  full_name: string | null;
}

interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
}

const SessionContext = createContext<SessionState>({
  loading: true,
  session: null,
  profile: null,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({
    loading: true,
    session: null,
    profile: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(session: Session | null) {
      if (!session) {
        if (!cancelled) setState({ loading: false, session: null, profile: null });
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("id, campaign_id, role, full_name")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!cancelled) setState({ loading: false, session, profile: data ?? null });
    }

    void supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
