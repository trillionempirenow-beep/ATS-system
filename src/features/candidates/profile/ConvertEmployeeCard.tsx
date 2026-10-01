import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CandidateProfileDto } from '@shared/api/candidates';
import { EMPLOYEE_STATUS_LABELS } from '@shared/domain/people';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Field, Select, TextInput, formStyles } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { Card, CardHeader, DescriptionList } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useCandidateAction } from '../api';
import w from '../../workspace.module.css';

/** R37: a hired candidate becomes an employee record linked to this application. */
export function ConvertEmployeeCard({ c }: { c: CandidateProfileDto }) {
  const toast = useToast();
  const [hiredPosition, setHiredPosition] = useState(c.job.title);
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [departmentId, setDepartmentId] = useState<string>(() => String(c.departments.find((d) => d.name === c.job.department)?.id ?? ''));
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const convert = useCandidateAction(c.applicationId, () => api.post(`/candidates/${c.applicationId}/convert-to-employee`, {
    hiredPosition, employeeNumber, departmentId: departmentId ? Number(departmentId) : null, startDate,
  }));

  if (c.employee) {
    return (
      <Card>
        <CardHeader title="Employee record" actions={<Badge tone="success" icon="checkcircle">Added to Employees</Badge>} />
        <DescriptionList items={[
          ['Employee number', <span key="n" className="mono">{c.employee.employeeNumber ?? '—'}</span>],
          ['Hired position', c.employee.jobTitle ?? '—'],
          ['Department', c.employee.department ?? '—'],
          ['Start date', formatDate(c.employee.startDate)],
          ['Status', EMPLOYEE_STATUS_LABELS[c.employee.status]],
        ]} />
        <div className={w.mt12}><Link to="/app/employees" className={w.link}>Open Employees</Link></div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Add to employees" subtitle="Create the employee record for this hire. The recruitment history stays linked." />
      <div className={formStyles.stack}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className={formStyles.grid2}>
          <Field label="Hired position"><TextInput value={hiredPosition} onChange={(e) => setHiredPosition(e.target.value)} /></Field>
          <Field label="Employee number" optional hint="Generated when left blank."><TextInput value={employeeNumber} onChange={(e) => setEmployeeNumber(e.target.value)} placeholder={`EMP-${new Date().getFullYear()}-${String(c.applicationId).padStart(4, '0')}`} /></Field>
          <Field label="Department"><Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="Unassigned" options={c.departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
          <Field label="Start date"><TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        </div>
        <div className={w.endRow}>
          <Button icon="employees" loading={convert.isPending} onClick={() => { setError(null); convert.mutate(undefined, {
            onSuccess: () => toast.success(`${c.name} was added to Employees.`),
            onError: (e) => setError(errorMessage(e)),
          }); }}>Add to employees</Button>
        </div>
      </div>
    </Card>
  );
}
