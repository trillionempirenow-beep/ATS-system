import type { ReactNode } from 'react';
import { useAuth } from './providers/AuthProvider';
import { AuthLayout } from './layouts/AuthLayout';
import { SessionEndedPage } from '@/features/auth/PasswordPages';

/** When the API reports an expired session, the whole app yields to the E07 screen. */
export function SessionGate({ children }: { children: ReactNode }) {
  const { sessionEnded } = useAuth();
  if (sessionEnded) return <AuthLayout><SessionEndedPage /></AuthLayout>;
  return <>{children}</>;
}
