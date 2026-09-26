import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationKeys } from '../notifications/api';

export const adminKeys = {
  admins: ['admin', 'admins'] as const,
  users: (status?: string) => ['admin', 'users', status ?? 'all'] as const,
  resets: ['admin', 'password-resets'] as const,
  portal: ['admin', 'portal'] as const,
  audit: (params: Record<string, string | undefined>) => ['admin', 'audit', params] as const,
  settings: ['admin', 'settings'] as const,
};

/** Any admin write: refresh every admin view and the sidebar badges afterwards. */
export function useAdminMutation<TInput, TResult = unknown>(run: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      void qc.invalidateQueries({ queryKey: notificationKeys.shell });
    },
  });
}
