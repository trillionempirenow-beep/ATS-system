-- AI matching between registered applicants and job postings. Filled once per
-- application (the applicant against every open job, right after they apply)
-- and once per job (the job against every applicant, when it is published),
-- so pages read stored results instead of calling the AI again.

create table candidate_job_matches (
  candidate_id  bigint not null references candidates(id) on delete cascade,
  job_id        bigint not null references jobs(id) on delete cascade,
  score         smallint not null check (score between 0 and 100),
  -- For the hiring team: why, in one or two sentences.
  reason        text not null default '',
  matched       text[] not null default '{}',
  missing       text[] not null default '{}',
  created_at    timestamptz not null default now(),
  primary key (candidate_id, job_id)
);
create index candidate_job_matches_job on candidate_job_matches (job_id, score desc);

alter table candidate_job_matches enable row level security;

-- When the job's one-time scoring against all applicants ran (null: not yet).
alter table jobs add column matched_at timestamptz;

-- Role suggestions the matching made (author_id stays null), told apart from a
-- staff member's suggestion whose author was later deleted.
alter table candidate_role_suggestions add column from_ai boolean not null default false;
