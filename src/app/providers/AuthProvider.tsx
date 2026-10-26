import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@shared/api/auth';
import { canPublishJobs, hasPermission, isAdminLevel, isSuperAdmin, roleAllowed, type PermissionKey, type Role } from '@shared/domain/access';
import { api, ApiError, SESSION_ENDED_EVENT, setCsrfToken } from '@/lib/api';

interface AuthApi {
  user: MeDto | null;
  loading: boolean;
  sessionEnded: boolean;
  /** True from the moment someone signs out until the next sign-in: guards redirect to a plain /login. */
  signedOut: boolean;
  setUser: (me: MeDto) => void;
  signOut: () => Promise<void>;
  clearSessionEnded: () => void;
  can: {
    permission: (p: PermissionKey) => boolean;
    roles: (...r: Role[]) => boolean;
    publish: boolean;
    adminLevel: boolean;
    superAdmin: boolean;
  };
}

const AuthContext = createContext<AuthApi | null>(null);
const LastUserContext = createContext<{ current: MeDto | null } | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [sessionEnded, setSessionEnded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<MeDto>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
  const user = me.data ?? null;
  const lastUser = useRef<MeDto | null>(null);
  if (user) lastUser.current = user;

  useEffect(() => { setCsrfToken(user?.csrfToken ?? null); }, [user]);

  useEffect(() => {
    const onEnded = () => {
      setSessionEnded(true);
      setCsrfToken(null);
      qc.setQueryData(ME_KEY, null);
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [qc]);

  const setUser = useCallback((u: MeDto) => {
    setCsrfToken(u.csrfToken);
    setSessionEnded(false);
    setSignedOut(false);
    lastUser.current = u;
    qc.setQueryData(ME_KEY, u);
  }, [qc]);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* signing out anyway */ }
    setCsrfToken(null);
    // Tell the guards first (they send the browser to a plain /login), then drop the
    // previous user's data. The auth query itself is updated in place, never cleared:
    // clearing the cache detaches it, and the app would keep believing someone is signed in.
    setSignedOut(true);
    setSessionEnded(false);
    qc.setQueryData(ME_KEY, null);
    window.setTimeout(() => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
    }, 50);
  }, [qc]);

  const value = useMemo<AuthApi>(() => {
    const subject = user ? { id: user.id, role: user.role, permissions: user.permissions } : null;
    return {
      user,
      loading: me.isLoading,
      sessionEnded,
      signedOut,
      setUser,
      signOut,
      clearSessionEnded: () => setSessionEnded(false),
      can: {
        permission: (p) => (subject ? hasPermission(subject, p) : false),
        roles: (...r) => (subject ? roleAllowed(subject, r) : false),
        publish: subject ? canPublishJobs(subject) : false,
        adminLevel: subject ? isAdminLevel(subject) : false,
        superAdmin: subject ? isSuperAdmin(subject) : false,
      },
    };
  }, [user, me.isLoading, sessionEnded, signedOut, setUser, signOut]);

  return (
    <AuthContext.Provider value={value}>
      <LastUserContext.Provider value={lastUser}>{children}</LastUserContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For pages behind RequireAuth, where a user is guaranteed. */
export function useMe(): MeDto {
  const { user } = useAuth();
  const ctx = useContext(LastUserContext);
  // While signing out the screen is replaced a moment later; keep it rendering the
  // last user instead of throwing into the error screen.
  const me = user ?? ctx?.current ?? null;
  if (!me) throw new Error('useMe used outside an authenticated route');
  return me;
}
