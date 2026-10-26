import { BOARD_STAGES, type Activity, type Candidate, type Interview, type Job, type Stage, type Teammate } from './types';

/* Everything is generated relative to "now" so the demo always looks current. */
const DAY = 86_400_000;
function daysAgo(days: number, hour = 10, minute = 0): string {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function daysAhead(days: number, hour: number, minute = 0): string {
  return daysAgo(-days, hour, minute);
}

/* Small deterministic PRNG so the seed is identical on every load. */
function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rand = prng(42);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

export const ME: Teammate = { name: 'Jordan Reyes', role: 'Senior Recruiter', email: 'recruiter@acme.test' };

export const TEAM: Teammate[] = [
  ME,
  { name: 'Priya Natarajan', role: 'Head of Talent', email: 'admin@acme.test' },
  { name: 'Marco Villanueva', role: 'Engineering Manager', email: 'manager@acme.test' },
  { name: 'Hana Okafor', role: 'Design Director', email: 'hana@acme.test' },
  { name: 'Leo Brandt', role: 'VP Product', email: 'leo@acme.test' },
];

export const JOBS: Job[] = [
  {
    id: 'senior-frontend-engineer',
    title: 'Senior Frontend Engineer',
    department: 'Engineering',
    location: 'Manila, PH',
    mode: 'Hybrid',
    type: 'Full-time',
    level: 'Senior',
    salary: '₱180k – ₱240k / mo',
    status: 'open',
    postedAt: daysAgo(6),
    featured: true,
    summary:
      'Own the candidate-facing surfaces of our hiring platform: the careers site, the application flow and the status tracker that thousands of applicants see every week.',
    responsibilities: [
      'Ship accessible, fast React interfaces used by recruiters and applicants',
      'Shape our design system together with the Design team',
      'Lead technical design for new product areas and review your peers’ work',
      'Mentor two mid-level engineers',
    ],
    requirements: [
      '5+ years building production web apps with React and TypeScript',
      'A strong eye for detail in UI, motion and accessibility',
      'Experience with design tokens or a component library',
      'Clear written communication — we work async across time zones',
    ],
    skills: ['React', 'TypeScript', 'Accessibility', 'CSS', 'Design systems', 'Testing'],
    hiringManager: 'Marco Villanueva',
  },
  {
    id: 'product-designer',
    title: 'Product Designer, Hiring Experience',
    department: 'Design',
    location: 'Remote · APAC',
    mode: 'Remote',
    type: 'Full-time',
    level: 'Mid–Senior',
    salary: '₱150k – ₱200k / mo',
    status: 'open',
    postedAt: daysAgo(3),
    featured: true,
    summary:
      'Design the end-to-end hiring experience, from the moment someone finds a role to the day they sign their offer.',
    responsibilities: [
      'Run discovery with recruiters, hiring managers and applicants',
      'Prototype and test flows in Figma and in code',
      'Contribute components and patterns to our design system',
    ],
    requirements: [
      '4+ years of product design for web applications',
      'A portfolio showing systems thinking and craft',
      'Comfort presenting work and taking critique',
    ],
    skills: ['Figma', 'Prototyping', 'User research', 'Design systems', 'Accessibility'],
    hiringManager: 'Hana Okafor',
  },
  {
    id: 'backend-engineer-platform',
    title: 'Backend Engineer, Platform',
    department: 'Engineering',
    location: 'Cebu, PH',
    mode: 'Hybrid',
    type: 'Full-time',
    level: 'Mid',
    salary: '₱130k – ₱175k / mo',
    status: 'open',
    postedAt: daysAgo(12),
    summary: 'Build the Node.js services behind scheduling, notifications and our interview room.',
    responsibilities: [
      'Design and maintain well-tested APIs in Node.js and TypeScript',
      'Own reliability for realtime services',
      'Partner with frontend engineers on contracts and performance',
    ],
    requirements: ['3+ years with Node.js in production', 'Solid SQL and data modelling', 'Experience with queues or realtime systems'],
    skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis', 'Testing'],
    hiringManager: 'Marco Villanueva',
  },
  {
    id: 'talent-acquisition-partner',
    title: 'Talent Acquisition Partner',
    department: 'People',
    location: 'Manila, PH',
    mode: 'On-site',
    type: 'Full-time',
    level: 'Mid',
    salary: '₱80k – ₱110k / mo',
    status: 'open',
    postedAt: daysAgo(9),
    summary: 'Partner with engineering and design leaders to hire the people who will shape Acme’s next chapter.',
    responsibilities: ['Run full-cycle recruiting for 8–12 roles at a time', 'Coach hiring panels on structured interviews', 'Report on funnel health weekly'],
    requirements: ['3+ years in-house or agency recruiting', 'Experience hiring technical roles', 'Excellent candidate communication'],
    skills: ['Sourcing', 'Structured interviews', 'Stakeholder management', 'ATS'],
    hiringManager: 'Priya Natarajan',
  },
  {
    id: 'product-manager-insights',
    title: 'Product Manager, Insights',
    department: 'Product',
    location: 'Remote · PH',
    mode: 'Remote',
    type: 'Full-time',
    level: 'Senior',
    salary: '₱170k – ₱230k / mo',
    status: 'open',
    postedAt: daysAgo(15),
    summary: 'Lead the analytics product that helps hiring teams understand their funnel and make better decisions.',
    responsibilities: ['Own the Insights roadmap', 'Define metrics with customers and data teams', 'Write crisp specs and ship iteratively'],
    requirements: ['5+ years in product management', 'Shipped analytics or data products', 'Comfortable with SQL'],
    skills: ['Product strategy', 'Analytics', 'SQL', 'Discovery'],
    hiringManager: 'Leo Brandt',
  },
  {
    id: 'account-executive',
    title: 'Account Executive, Mid-Market',
    department: 'Sales',
    location: 'Singapore',
    mode: 'Hybrid',
    type: 'Full-time',
    level: 'Mid',
    salary: 'S$7k – S$9k / mo + commission',
    status: 'open',
    postedAt: daysAgo(20),
    summary: 'Bring Acme People to growing companies across Southeast Asia.',
    responsibilities: ['Run the full sales cycle', 'Build pipeline with SDRs', 'Forecast accurately'],
    requirements: ['3+ years of B2B SaaS sales', 'Track record against quota'],
    skills: ['SaaS sales', 'Negotiation', 'Forecasting', 'CRM'],
    hiringManager: 'Leo Brandt',
  },
  {
    id: 'people-operations-intern',
    title: 'People Operations Intern',
    department: 'People',
    location: 'Manila, PH',
    mode: 'On-site',
    type: 'Internship',
    level: 'Entry',
    salary: '₱25k / mo allowance',
    status: 'open',
    postedAt: daysAgo(2),
    summary: 'A six-month internship across onboarding, HR systems and employee experience.',
    responsibilities: ['Support onboarding for new hires', 'Keep employee records accurate', 'Help plan team events'],
    requirements: ['Final-year student or recent graduate', 'Organised and discreet'],
    skills: ['Organisation', 'Communication', 'Spreadsheets'],
    hiringManager: 'Priya Natarajan',
  },
  {
    id: 'data-engineer',
    title: 'Data Engineer',
    department: 'Engineering',
    location: 'Remote · PH',
    mode: 'Remote',
    type: 'Contract',
    level: 'Senior',
    salary: '₱1,400 / hr',
    status: 'open',
    postedAt: daysAgo(5),
    summary: 'A 9-month contract to rebuild the pipelines behind our reporting.',
    responsibilities: ['Model hiring data in the warehouse', 'Build reliable dbt pipelines', 'Document everything'],
    requirements: ['4+ years in data engineering', 'dbt and SQL fluency'],
    skills: ['SQL', 'dbt', 'Python', 'Airflow'],
    hiringManager: 'Marco Villanueva',
  },
  {
    id: 'customer-success-lead',
    title: 'Customer Success Lead',
    department: 'Operations',
    location: 'Manila, PH',
    mode: 'Hybrid',
    type: 'Full-time',
    level: 'Lead',
    salary: '₱120k – ₱160k / mo',
    status: 'pending',
    postedAt: daysAgo(1),
    summary: 'Build and lead the team that makes our customers successful.',
    responsibilities: ['Hire and coach a team of five', 'Own retention and expansion'],
    requirements: ['5+ years in customer success, 2 leading a team'],
    skills: ['Leadership', 'Onboarding', 'Retention'],
    hiringManager: 'Priya Natarajan',
  },
  {
    id: 'ios-engineer',
    title: 'iOS Engineer',
    department: 'Engineering',
    location: 'Remote · APAC',
    mode: 'Remote',
    type: 'Full-time',
    level: 'Mid',
    salary: '₱140k – ₱190k / mo',
    status: 'draft',
    postedAt: daysAgo(0),
    summary: 'Build the Acme People app for hiring managers on the go.',
    responsibilities: ['Ship SwiftUI features end to end'],
    requirements: ['3+ years of iOS development'],
    skills: ['Swift', 'SwiftUI'],
    hiringManager: 'Marco Villanueva',
  },
  {
    id: 'office-manager',
    title: 'Office Manager',
    department: 'Operations',
    location: 'Cebu, PH',
    mode: 'On-site',
    type: 'Full-time',
    level: 'Mid',
    salary: '₱60k – ₱75k / mo',
    status: 'closed',
    postedAt: daysAgo(48),
    summary: 'Run our Cebu studio.',
    responsibilities: ['Keep the office running'],
    requirements: ['2+ years in office management'],
    skills: ['Operations', 'Vendors'],
    hiringManager: 'Priya Natarajan',
  },
];

const FIRST = ['Maya', 'Ethan', 'Aisha', 'Noah', 'Lia', 'Rafael', 'Sofia', 'Kenji', 'Amara', 'Daniel', 'Isla', 'Tomas', 'Zara', 'Miguel', 'Chloe', 'Arjun', 'Nadia', 'Luca', 'Hiro', 'Bea', 'Samuel', 'Ines', 'Theo', 'Rina', 'Omar', 'Clara', 'Joaquin', 'Mei', 'Felix', 'Yara', 'Andre', 'Talia', 'Paolo', 'June', 'Kai', 'Elena'];
const LAST = ['Santos', 'Cruz', 'Rahman', 'Lim', 'Garcia', 'Tan', 'Reyes', 'Nakamura', 'Mensah', 'Ocampo', 'Fischer', 'Dela Rosa', 'Haddad', 'Lopez', 'Wong', 'Mehta', 'Aziz', 'Romano', 'Sato', 'Bautista', 'Adeyemi', 'Costa', 'Novak', 'Aquino', 'Farouk', 'Weber', 'Mendoza', 'Chen', 'Klein', 'Ibrahim', 'Navarro', 'Levi', 'Ramos', 'Park', 'Mori', 'Petrova'];
const COMPANIES = ['Northwind', 'Globex', 'Initech', 'Umbrella Labs', 'Stark Digital', 'Hooli', 'Vandelay', 'Pied Piper', 'Wayne Fintech', 'Soylent Health'];
const CITIES = ['Manila', 'Quezon City', 'Makati', 'Cebu', 'Davao', 'Singapore', 'Taguig', 'Pasig', 'Iloilo'];
const SOURCES: Candidate['source'][] = ['Careers site', 'Careers site', 'Careers site', 'Referral', 'LinkedIn', 'LinkedIn', 'Job board', 'Agency'];

/* Where 36 candidates sit across the board: a believable funnel shape. */
const STAGE_PLAN: Stage[] = [
  ...Array<Stage>(10).fill('new'),
  ...Array<Stage>(8).fill('screening'),
  ...Array<Stage>(6).fill('interview'),
  ...Array<Stage>(3).fill('final_interview'),
  ...Array<Stage>(3).fill('offer'),
  ...Array<Stage>(2).fill('hired'),
  ...Array<Stage>(4).fill('rejected'),
];

const REVIEW_LINES = [
  'Clear communicator, structured answers. Strong on fundamentals.',
  'Great portfolio walkthrough; would like to probe system design more.',
  'Excellent culture add — asked thoughtful questions about how we work.',
  'Solid, but light on the leadership examples we need for this level.',
  'Standout. Moved quickly through the exercise and explained trade-offs well.',
];

const NOTE_LINES = [
  'Prefers a hybrid setup, available to start in 30 days.',
  'Referred by Marco — worked together at Globex.',
  'Salary expectation is within band.',
  'Asked about the mentoring programme, follow up with details.',
  'Has a competing offer, decision expected in two weeks.',
];

export const REF_PREFIX = 'ACM';
export function makeRef(n: number): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let x = n * 7919 + 104729;
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length) + i * 31;
  }
  return `${REF_PREFIX}-${out}`;
}

function buildHistory(stage: Stage, appliedDaysAgo: number): Candidate['history'] {
  const path: Stage[] = [];
  if (stage === 'rejected') {
    path.push('new', 'screening', 'rejected');
  } else {
    const idx = (BOARD_STAGES as readonly Stage[]).indexOf(stage);
    for (let i = 0; i <= idx; i += 1) {
      const s = BOARD_STAGES[i];
      if (s === 'final_interview' && rand() < 0.4 && stage !== 'final_interview') continue;
      path.push(s);
    }
  }
  const step = Math.max(1, Math.floor(appliedDaysAgo / Math.max(1, path.length)));
  return path.map((s, i) => ({ stage: s, at: daysAgo(Math.max(0, appliedDaysAgo - i * step), 9 + i) }));
}

const openJobs = JOBS.filter((j) => j.status === 'open');

export const CANDIDATES: Candidate[] = STAGE_PLAN.map((stage, i) => {
  const first = FIRST[i];
  const last = LAST[(i * 7) % LAST.length];
  const job = i < 14 ? openJobs[i % 3] : openJobs[i % openJobs.length];
  const appliedDaysAgo = stage === 'new' ? Math.floor(rand() * 5) : 6 + Math.floor(rand() * 26);
  const history = buildHistory(stage, appliedDaysAgo);
  const skillPool = job.skills;
  const matched = skillPool.filter(() => rand() > 0.3);
  const match = Math.min(98, Math.round(48 + (matched.length / skillPool.length) * 44 + rand() * 8));
  const reviews: Candidate['reviews'] = [];
  for (const h of history) {
    if (h.stage === 'screening' && history.some((x) => (BOARD_STAGES as readonly Stage[]).indexOf(x.stage) > 1 || x.stage === 'rejected'))
      reviews.push({ stage: 'screening', reviewer: ME.name, rating: (3 + Math.floor(rand() * 3)) as 3 | 4 | 5, summary: pick(REVIEW_LINES), at: h.at });
    if (h.stage === 'interview' && history.some((x) => ['final_interview', 'offer', 'hired'].includes(x.stage)))
      reviews.push({ stage: 'interview', reviewer: job.hiringManager, rating: (3 + Math.floor(rand() * 3)) as 3 | 4 | 5, summary: pick(REVIEW_LINES), at: h.at });
  }
  return {
    id: `c${i + 1}`,
    ref: makeRef(i + 1),
    name: `${first} ${last}`,
    email: `${first}.${last}`.toLowerCase().replace(/\s+/g, '') + '@example.com',
    phone: `+63 9${17 + (i % 10)} ${String(100 + i * 13).slice(-3)} ${String(4000 + i * 97).slice(-4)}`,
    location: `${pick(CITIES)}, PH`,
    headline: `${pick(['Senior', 'Lead', '', 'Staff', ''])} ${job.skills[0]} ${job.department === 'Engineering' ? 'Engineer' : job.department === 'Design' ? 'Designer' : 'Specialist'}`.replace(/\s+/g, ' ').trim(),
    jobId: job.id,
    stage,
    source: pick(SOURCES),
    appliedAt: history[0].at,
    stageChangedAt: history[history.length - 1].at,
    match,
    skills: matched.length ? matched : skillPool.slice(0, 2),
    experience: [
      { company: pick(COMPANIES), role: job.title.replace(/,.*/, '').replace('Senior ', ''), years: `${2019 + (i % 4)} – Present` },
      { company: pick(COMPANIES), role: `Associate ${job.department === 'Engineering' ? 'Developer' : 'Specialist'}`, years: `${2015 + (i % 4)} – ${2019 + (i % 4)}` },
    ],
    education: pick(['BS Computer Science, University of the Philippines', 'BFA Design, De La Salle–College of Saint Benilde', 'BS Information Technology, Ateneo de Manila', 'BS Psychology, University of Santo Tomas', 'BS Business Administration, UP Cebu']),
    links: [
      { label: 'LinkedIn', url: 'https://linkedin.com/in/example' },
      { label: job.department === 'Design' ? 'Portfolio' : 'GitHub', url: 'https://example.com' },
    ],
    coverNote:
      'I have followed Acme People for a while and love how much care goes into the candidate experience. I would be excited to bring my experience to a team that sweats the details.',
    notes: rand() > 0.5 ? [{ id: `n${i}`, author: pick(TEAM).name, body: pick(NOTE_LINES), at: daysAgo(Math.max(0, appliedDaysAgo - 1), 15) }] : [],
    reviews,
    history,
    starred: rand() > 0.82,
  };
});

/* Two hand-written demo applicants for the public status tracker. */
CANDIDATES[20] = { ...CANDIDATES[20], name: 'Maya Santos', email: 'maya@example.com' };
CANDIDATES[28] = { ...CANDIDATES[28], name: 'Kenji Nakamura', email: 'kenji@example.com' };

export const DEMO_LOOKUPS = [
  { ref: CANDIDATES[20].ref, email: CANDIDATES[20].email },
  { ref: CANDIDATES[28].ref, email: CANDIDATES[28].email },
  { ref: CANDIDATES[2].ref, email: CANDIDATES[2].email },
];

const interviewing = CANDIDATES.filter((c) => ['screening', 'interview', 'final_interview'].includes(c.stage));

export const INTERVIEWS: Interview[] = interviewing.slice(0, 11).map((c, i) => {
  const job = JOBS.find((j) => j.id === c.jobId)!;
  const stage = c.stage as Interview['stage'];
  const dayOffset = [0, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5][i];
  const hour = [9, 11, 15, 10, 14, 9, 16, 11, 10, 13, 15][i];
  return {
    id: `i${i + 1}`,
    candidateId: c.id,
    title: stage === 'screening' ? 'Recruiter screen' : stage === 'interview' ? 'Technical interview' : 'Final interview',
    stage,
    at: daysAhead(dayOffset, hour, i % 2 ? 30 : 0),
    minutes: stage === 'screening' ? 30 : 60,
    mode: stage === 'final_interview' ? 'On-site' : i % 3 === 2 ? 'External link' : 'Acme Room',
    panel: stage === 'screening' ? [ME.name] : [job.hiringManager, ME.name],
  };
});

export const ACTIVITY: Activity[] = [
  { id: 'a1', who: 'Priya Natarajan', text: 'approved the posting Talent Acquisition Partner', at: daysAgo(0, 9, 12), kind: 'job' },
  { id: 'a2', who: CANDIDATES[0].name, text: `applied for ${JOBS.find((j) => j.id === CANDIDATES[0].jobId)!.title}`, at: daysAgo(0, 8, 40), kind: 'apply' },
  { id: 'a3', who: 'Marco Villanueva', text: `moved ${CANDIDATES[24].name} to Final interview`, at: daysAgo(1, 17, 5), kind: 'move' },
  { id: 'a4', who: 'Jordan Reyes', text: `left a note on ${CANDIDATES[12].name}`, at: daysAgo(1, 14, 22), kind: 'note' },
  { id: 'a5', who: 'Hana Okafor', text: `scheduled an interview with ${CANDIDATES[19].name}`, at: daysAgo(1, 11, 3), kind: 'interview' },
  { id: 'a6', who: 'Jordan Reyes', text: `sent an offer to ${CANDIDATES[27].name}`, at: daysAgo(2, 16, 45), kind: 'move' },
];

/** Weekly application counts for the last 12 weeks (oldest first). */
export const WEEKLY_APPLICATIONS = [38, 42, 35, 51, 47, 58, 54, 63, 71, 66, 79, 84];

export const SOURCE_OF_HIRE = [
  { source: 'Careers site', hires: 14 },
  { source: 'Referral', hires: 9 },
  { source: 'LinkedIn', hires: 6 },
  { source: 'Job board', hires: 3 },
  { source: 'Agency', hires: 2 },
];
