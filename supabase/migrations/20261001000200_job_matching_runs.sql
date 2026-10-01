-- Job matching can be run again at any time: track a run in progress and the
-- last failure, so the job page can show "Matching…" and say when a run failed.
alter table jobs add column matching_started_at timestamptz;
alter table jobs add column matching_error text;
