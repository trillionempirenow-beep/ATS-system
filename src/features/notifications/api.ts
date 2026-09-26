import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationsDto, ShellSummaryDto } from '@shared/api/me';
import type { NotificationFilter } from '@shared/domain/people';
import { api, qs } from '@/lib/api';
import { joinChannel } from '@/lib/realtime';
import { useAuth } from '@/app/providers/AuthProvider';

export const notificationKeys = {
  shell: ['shell'] as const,
  list: (filter?: NotificationFilter, limit?: number) => ['notifications', filter ?? 'all', limit ?? 150] as const,
};

/**
 * Bell count and sidebar badges. Polls every 30 seconds (the PHP behaviour) and
 * refreshes at once when the user's realtime channel reports a new item.
 */
export function useShellSummary() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: notificationKeys.shell,
    queryFn: () => api.get<ShellSummaryDto>('/shell'),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!user) return;
    let channel: ReturnType<typeof joinChannel> | null = null;
    try {
      channel = joinChannel(user.realtime.driver, user.realtime.userChannel, `user-${user.id}`);
      channel.on('notification:new', () => {
        void qc.invalidateQueries({ queryKey: notificationKeys.shell });
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      });
    } catch {
      // Realtime not configured: the 30-second poll still keeps the bell current.
    }
    return () => channel?.close();
  }, [user, qc]);
  return query;
}

export function useNotifications(filter?: NotificationFilter, limit = 150) {
  return useQuery({
    queryKey: notificationKeys.list(filter, limit),
    queryFn: () => api.get<NotificationsDto>(`/notifications${qs({ filter, limit })}`),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids?: number[]; all?: boolean }) => api.post('/notifications/read', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: notificationKeys.shell });
    },
  });
}

export function useClearRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/notifications/read'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
