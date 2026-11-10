import { describe, expect, it } from 'vitest';
import { viewsFromSteps } from '../../server/modules/assistant/assistant.views.js';

/** One agent step the way n8n reports it: the HTTP tool's answer is a JSON string holding a list. */
const step = (what: string, result: unknown, extra: object = {}) => ({
  action: { tool: 'lookup', toolInput: { what, ...extra }, log: 'Calling lookup' },
  observation: JSON.stringify([{ ok: true, result }]),
});

describe('assistant result tables', () => {
  it('turns a candidate lookup into a table with stage keys and an open link', () => {
    const views = viewsFromSteps([
      step('candidates', {
        count: 2,
        candidates: [
          { applicationId: 7, candidateId: 3, name: 'Dave Cabilangan', email: 'dave@example.com', job: 'Product Manager', stage: 'Final interview', currentTitle: 'Engineer', applied: 'Mon, Oct 5, 9:00 AM' },
          { applicationId: 8, candidateId: 4, name: 'Bianca Reyes', email: 'bianca@example.com', job: 'Graphic Designer', stage: 'Applied', currentTitle: null, applied: 'Tue, Oct 6, 9:00 AM' },
        ],
      }),
    ]);
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(v.title).toBe('Candidates');
    expect(v.rows).toHaveLength(2);
    expect(v.rows[0]).toMatchObject({ name: 'Dave Cabilangan', stage: 'final_interview', _link: '/app/candidates/7' });
    expect(v.rows[1]).toMatchObject({ stage: 'new', title: null });
    expect(v.columns.map((c) => c.key)).toEqual(['name', 'job', 'stage', 'title', 'applied']);
  });

  it('reads the tool answer whether it is a list, an object or plain text', () => {
    const result = { jobs: [{ id: 1, title: 'Designer', department: 'Design', location: 'Manila', status: 'open', waitingForApproval: false, applicants: 3 }] };
    const asObject = { action: { tool: 'lookup', toolInput: '{"what":"jobs"}' }, observation: { ok: true, result } };
    const views = viewsFromSteps([asObject]);
    expect(views[0]?.rows[0]).toMatchObject({ title: 'Designer', status: 'open', applicants: 3, _link: '/app/jobs/1' });
  });

  it('marks a posting that is waiting for approval', () => {
    const views = viewsFromSteps([step('jobs', { jobs: [{ id: 2, title: 'Analyst', department: null, location: null, status: 'draft', waitingForApproval: true, applicants: 0 }] })]);
    expect(views[0]?.rows[0]?.status).toBe('Waiting for approval');
  });

  it('builds the other list lookups too', () => {
    const views = viewsFromSteps([
      step('interviews', { today: 1, thisWeek: 4, interviews: [{ id: 5, applicationId: 7, candidate: 'Dave', job: 'PM', when: 'Wed, Nov 11, 2:00 PM', type: 'interview', format: 'video', interviewer: 'Kai', status: 'scheduled' }] }),
      step('departments', [{ id: 1, name: 'Engineering' }, { id: 2, name: 'Design' }]),
      step('pipeline', { Applied: 3, Screening: 2, Interview: 0 }),
    ]);
    expect(views.map((v) => v.title)).toEqual(['Interviews', 'Departments', 'Pipeline']);
    expect(views[0]?.subtitle).toBe('1 today · 4 this week');
    expect(views[2]?.rows.map((r) => r.stage)).toEqual(['new', 'screening', 'interview']);
  });

  it('lists the postings waiting for approval', () => {
    const views = viewsFromSteps([step('approvals', { canApprove: true, jobPostings: [{ jobId: 9, title: 'Chef', submittedBy: 'Kai', submitted: 'Mon, Nov 9' }] })]);
    expect(views[0]?.title).toBe('Waiting for approval');
    expect(views[0]?.rows[0]).toMatchObject({ title: 'Chef', by: 'Kai', _link: '/app/jobs/approvals' });
  });

  it('shows no table for a failed, empty, single-record or unknown lookup', () => {
    expect(viewsFromSteps([{ action: { tool: 'lookup', toolInput: { what: 'candidates' } }, observation: JSON.stringify([{ error: 'Authorization failed' }]) }])).toEqual([]);
    expect(viewsFromSteps([step('candidates', { count: 0, candidates: [] })])).toEqual([]);
    expect(viewsFromSteps([step('candidate', { candidateId: 1, name: 'Dave' })])).toEqual([]);
    expect(viewsFromSteps([{ action: { tool: 'propose', toolInput: { action: 'move_stage' } }, observation: JSON.stringify([{ ok: true, result: { status: 'Prepared' } }]) }])).toEqual([]);
    expect(viewsFromSteps(undefined)).toEqual([]);
    expect(viewsFromSteps('garbage')).toEqual([]);
  });

  it('shows the same lookup once, keeps at most three tables, and caps long lists', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, name: `Dept ${i}` }));
    const same = viewsFromSteps([step('departments', many), step('departments', many)]);
    expect(same).toHaveLength(1);
    expect(same[0]?.rows).toHaveLength(100);
    const four = viewsFromSteps([step('departments', many), step('interviewers', many), step('pipeline', { Applied: 1 }), step('approvals', { jobPostings: [{ jobId: 1, title: 'X' }] })]);
    expect(four).toHaveLength(3);
  });
});
