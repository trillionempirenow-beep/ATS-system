import type { CandidateProfileDto } from '@shared/api/candidates';
import type { IconName } from '@/components/icon/Icon';
import { EmptyState, Timeline } from '@/components/ui/Feedback';
import { Card, CardHeader } from '@/components/ui/Surface';
import { formatDateTime } from '@/lib/format';

const ICONS: Record<string, IconName> = {
  pipeline_stage_move: 'pipeline',
  candidate_note: 'edit',
  candidate_feedback: 'chat',
  candidate_rating: 'star',
  ai_analysis_generated: 'sparkle',
  document_uploaded: 'upload',
  document_downloaded: 'doc',
  application_submitted: 'send',
  candidate_added_manually: 'plus',
  candidate_converted_to_employee: 'employees',
  application_withdrawn: 'xcircle',
};

function detail(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  const parts = Object.entries(details)
    .filter(([k, v]) => !['from', 'to', 'override'].includes(k) && v !== null && v !== '' && typeof v !== 'object')
    .map(([, v]) => String(v));
  return parts.length ? parts.join(' · ') : null;
}

export function ActivityTab({ c }: { c: CandidateProfileDto }) {
  return (
    <Card>
      <CardHeader title="Activity" subtitle="Everything recorded for this candidate, newest first" />
      {c.activity.length === 0 ? <EmptyState compact icon="layers" title="No activity yet" /> : (
        <Timeline items={c.activity.map((a) => ({
          key: a.id,
          title: a.label,
          sub: [a.actor ?? (a.action === 'application_submitted' ? 'Applicant' : 'System'), detail(a.details), formatDateTime(a.createdAt)].filter(Boolean).join(' · '),
          done: true,
          icon: ICONS[a.action] ?? 'check',
        }))} />
      )}
    </Card>
  );
}
