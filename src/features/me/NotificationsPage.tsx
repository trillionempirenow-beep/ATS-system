import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NOTIFICATION_FILTERS, type NotificationFilter } from '@shared/domain/people';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Card, PageHeader, PillTabs, type TabItem } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { errorMessage } from '@/lib/api';
import { NotificationItem } from '../notifications/NotificationItem';
import { useClearRead, useMarkRead, useNotifications, useShellSummary } from '../notifications/api';
import s from '../notifications/Notifications.module.css';
import w from '../workspace.module.css';

type Tab = 'all' | NotificationFilter;

export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('filter');
  const tab: Tab = raw && raw in NOTIFICATION_FILTERS ? (raw as NotificationFilter) : 'all';
  const list = useNotifications(tab === 'all' ? undefined : tab);
  const shell = useShellSummary();
  const markRead = useMarkRead();
  const clearRead = useClearRead();
  const toast = useToast();
  useEffect(() => { document.title = 'Notifications · Acme People'; }, []);
  // The page follows the shell's 30-second poll: when the unread count moves, refresh the list.
  const unread = shell.data?.unread;
  const refetch = list.refetch;
  useEffect(() => { if (unread !== undefined) void refetch(); }, [unread, refetch]);

  if (list.isError) return <QueryErrorPage error={list.error} onRetry={() => void list.refetch()} />;
  const items = list.data?.items ?? [];

  const tabs: TabItem<Tab>[] = [
    { key: 'all', label: 'All' },
    ...Object.entries(NOTIFICATION_FILTERS).map(([key, f]) => ({ key: key as NotificationFilter, label: f.label, count: key === 'unread' ? unread : undefined })),
  ];

  return (
    <div className={w.page}>
      <PageHeader title="Notifications" description="Updates are checked every 30 seconds while this page is open." crumbs={[{ label: 'Account' }, { label: 'Notifications' }]}
        actions={<>
          <Button variant="secondary" size="sm" icon="check" disabled={!unread} loading={markRead.isPending}
            onClick={() => markRead.mutate({ all: true }, { onError: (e) => toast.error(errorMessage(e)) })}>Mark all read</Button>
          <Button variant="ghost" size="sm" icon="trash" loading={clearRead.isPending}
            onClick={() => clearRead.mutate(undefined, { onSuccess: () => toast.success('Read notifications cleared.'), onError: (e) => toast.error(errorMessage(e)) })}>Clear read</Button>
        </>} />
      <PillTabs label="Filter notifications" value={tab} onChange={(k) => setParams(k === 'all' ? {} : { filter: k }, { replace: true })} items={tabs} />
      <Card padding={0}>
        {!list.data ? (
          <div className={`${w.stack8} ${w.pad16}`}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={56} />)}</div>
        ) : items.length === 0 ? (
          <EmptyState icon="bell" title="Nothing here." text="New applications, interview reminders and approval decisions will show up here." />
        ) : (
          <div className={s.list}>
            {items.map((n) => (
              <NotificationItem key={n.id} n={n} onOpen={(it) => { if (!it.read) markRead.mutate({ ids: [it.id] }); }} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
