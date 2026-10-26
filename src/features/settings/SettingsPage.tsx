import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '@/components/ui/Surface';
import { useAuth } from '@/app/providers/AuthProvider';
import { PreferencesTab } from './PreferencesTab';
import { WorkspaceTab } from './WorkspaceTab';
import w from '../workspace.module.css';

type TabKey = 'preferences' | 'workspace';

/** Everyone gets preferences for how the workspace looks and opens; admins also get the workspace tab. */
export function SettingsPage({ initialTab = 'preferences' }: { initialTab?: TabKey }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = (params.get('tab') as TabKey | null) ?? initialTab;
  const tab: TabKey = requested === 'workspace' && can.adminLevel ? 'workspace' : 'preferences';
  useEffect(() => { document.title = 'Settings · Acme People'; }, []);

  return (
    <div className={w.page}>
      <PageHeader
        title="Settings"
        description={tab === 'workspace' ? 'How your company appears and how hiring runs by default.' : 'Make the workspace look and open the way you like it.'}
        crumbs={[{ label: 'Account' }, { label: 'Settings' }]}
      />
      {can.adminLevel ? (
        <div className={w.mb16}>
          <Tabs<TabKey>
            label="Settings sections"
            value={tab}
            onChange={(k) => setParams(k === 'preferences' ? {} : { tab: k }, { replace: true })}
            items={[{ key: 'preferences', label: 'My preferences' }, { key: 'workspace', label: 'Workspace' }]}
          />
        </div>
      ) : null}
      {tab === 'workspace' ? <WorkspaceTab /> : <PreferencesTab />}
    </div>
  );
}
