import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@shared/api/auth';
import { canPublishJobs, hasPermission, isAdminLevel, isSuperAdmin, roleAllowed, type PermissionKey, type Role } from '@shared/domain/access';
import { api, ApiError, SESSION_ENDED_EVENT, setCsrfToken } from '@/lib/api';

interface AuthApi {
  user: MeDto | null;
  loading: boolean;
  sessionEnded: boolean;
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
export const ME_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [sessionEnded, setSessionEnded] = useState(false);
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
    qc.setQueryData(ME_KEY, u);
  }, [qc]);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* signing out anyway */ }
    setCsrfToken(null);
    qc.clear();
    qc.setQueryData(ME_KEY, null);
  }, [qc]);

  const value = useMemo<AuthApi>(() => {
    const subject = user ? { id: user.id, role: user.role, permissions: user.permissions } : null;
    return {
      user,
      loading: me.isLoading,
      sessionEnded,
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
  }, [user, me.isLoading, sessionEnded, setUser, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For pages behind RequireAuth, where a user is guaranteed. */
export function useMe(): MeDto {
  const { user } = useAuth();
  if (!user) throw new Error('useMe used outside an authenticated route');
  return user;
}
