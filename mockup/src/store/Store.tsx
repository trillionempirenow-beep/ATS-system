import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { ACTIVITY, CANDIDATES, INTERVIEWS, JOBS, ME, TEAM, makeRef } from '../data/seed';
import type { Activity, Candidate, Interview, Job, JobStatus, Stage, Teammate } from '../data/types';

/*
 * The whole "backend" of the mockup. State lives in memory and is mirrored to
 * localStorage so a demo survives a refresh. There is no database and no API.
 */

interface State {
  jobs: Job[];
  candidates: Candidate[];
  interviews: Interview[];
  activity: Activity[];
  user: Teammate | null;
  seq: number;
}

type Action =
  | { type: 'apply'; candidate: Candidate }
  | { type: 'move'; id: string; to: Stage; by: string }
  | { type: 'note'; id: string; body: string; by: string }
  | { type: 'star'; id: string }
  | { type: 'withdraw'; id: string }
  | { type: 'schedule'; interview: Interview; by: string }
  | { type: 'jobStatus'; id: string; status: JobStatus; by: string }
  | { type: 'addJob'; job: Job; by: string }
  | { type: 'login'; user: Teammate }
  | { type: 'logout' }
  | { type: 'reset' };

const STORAGE_KEY = 'acme-ats-mockup-v1';

function initialState(): State {
  return { jobs: JOBS, candidates: CANDIDATES, interviews: INTERVIEWS, activity: ACTIVITY, user: null, seq: CANDIDATES.length + 1 };
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* storage unavailable: fall back to the seed */
  }
  return initialState();
}

const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

function log(state: State, who: string, text: string, kind: Activity['kind']): Activity[] {
  return [{ id: uid(), who, text, at: now(), kind }, ...state.activity].slice(0, 40);
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'apply': {
      const job = state.jobs.find((j) => j.id === action.candidate.jobId);
      return {
        ...state,
        seq: state.seq + 1,
        candidates: [action.candidate, ...state.candidates],
        activity: log(state, action.candidate.name, `applied for ${job?.title ?? 'a role'}`, 'apply'),
      };
    }
    case 'move': {
      const c = state.candidates.find((x) => x.id === action.id);
      if (!c || c.stage === action.to) return state;
      const at = now();
      return {
        ...state,
        candidates: state.candidates.map((x) =>
          x.id === action.id ? { ...x, stage: action.to, stageChangedAt: at, history: [...x.history, { stage: action.to, at }] } : x,
        ),
        activity: log(state, action.by, `moved ${c.name} to ${stageText(action.to)}`, 'move'),
      };
    }
    case 'note': {
      const c = state.candidates.find((x) => x.id === action.id);
      if (!c) return state;
      return {
        ...state,
        candidates: state.candidates.map((x) =>
          x.id === action.id ? { ...x, notes: [{ id: uid(), author: action.by, body: action.body, at: now() }, ...x.notes] } : x,
        ),
        activity: log(state, action.by, `left a note on ${c.name}`, 'note'),
      };
    }
    case 'star':
      return { ...state, candidates: state.candidates.map((x) => (x.id === action.id ? { ...x, starred: !x.starred } : x)) };
    case 'withdraw': {
      const c = state.candidates.find((x) => x.id === action.id);
      if (!c) return state;
      return {
        ...state,
        candidates: state.candidates.map((x) => (x.id === action.id ? { ...x, withdrawn: true, stageChangedAt: now() } : x)),
        interviews: state.interviews.filter((i) => i.candidateId !== action.id),
        activity: log(state, c.name, 'withdrew their application', 'apply'),
      };
    }
    case 'schedule': {
      const c = state.candidates.find((x) => x.id === action.interview.candidateId);
      return {
        ...state,
        interviews: [...state.interviews, action.interview].sort((a, b) => a.at.localeCompare(b.at)),
        activity: log(state, action.by, `scheduled an interview with ${c?.name ?? 'a candidate'}`, 'interview'),
      };
    }
    case 'jobStatus': {
      const job = state.jobs.find((j) => j.id === action.id);
      const verb = action.status === 'open' ? 'published' : action.status === 'closed' ? 'closed' : 'updated';
      return {
        ...state,
        jobs: state.jobs.map((j) => (j.id === action.id ? { ...j, status: action.status, postedAt: action.status === 'open' ? now() : j.postedAt } : j)),
        activity: log(state, action.by, `${verb} the posting ${job?.title ?? ''}`, 'job'),
      };
    }
    case 'addJob':
      return { ...state, jobs: [action.job, ...state.jobs], activity: log(state, action.by, `drafted the posting ${action.job.title}`, 'job') };
    case 'login':
      return { ...state, user: action.user };
    case 'logout':
      return { ...state, user: null };
    case 'reset':
      return { ...initialState(), user: state.user };
  }
}

function stageText(s: Stage): string {
  return { new: 'Applied', screening: 'Screening', interview: 'Interview', final_interview: 'Final interview', offer: 'Offer', hired: 'Hired', rejected: 'Not selected' }[s];
}

export interface ApplyInput {
  jobId: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  links: { label: string; url: string }[];
  coverNote: string;
  skills: string[];
}

interface StoreValue extends State {
  dispatch: React.Dispatch<Action>;
  apply: (input: ApplyInput) => Candidate;
  login: (email: string) => Teammate;
  me: Teammate;
  jobById: (id: string) => Job | undefined;
  candidateById: (id: string) => Candidate | undefined;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode or blocked storage: the demo still works in memory */
    }
  }, [state]);

  const apply = useCallback(
    (input: ApplyInput): Candidate => {
      const job = state.jobs.find((j) => j.id === input.jobId);
      const at = now();
      const skills = input.skills.length ? input.skills : (job?.skills.slice(0, 3) ?? []);
      const match = job ? Math.min(97, 52 + Math.round((skills.filter((s) => job.skills.includes(s)).length / job.skills.length) * 42)) : 60;
      const candidate: Candidate = {
        id: `c${state.seq}-${uid()}`,
        ref: makeRef(state.seq + 100),
        name: input.name,
        email: input.email.toLowerCase(),
        phone: input.phone,
        location: input.location,
        headline: input.headline,
        jobId: input.jobId,
        stage: 'new',
        source: 'Careers site',
        appliedAt: at,
        stageChangedAt: at,
        match,
        skills,
        experience: [{ company: 'Current company', role: input.headline || 'Professional', years: '2021 – Present' }],
        education: 'Provided in résumé',
        links: input.links,
        coverNote: input.coverNote,
        notes: [],
        reviews: [],
        history: [{ stage: 'new', at }],
      };
      dispatch({ type: 'apply', candidate });
      return candidate;
    },
    [state.jobs, state.seq],
  );

  const login = useCallback((email: string): Teammate => {
    const user = TEAM.find((t) => t.email === email.toLowerCase()) ?? { ...ME, email };
    dispatch({ type: 'login', user });
    return user;
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      dispatch,
      apply,
      login,
      me: state.user ?? ME,
      jobById: (id) => state.jobs.find((j) => j.id === id),
      candidateById: (id) => state.candidates.find((c) => c.id === id),
    }),
    [state, apply, login],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
