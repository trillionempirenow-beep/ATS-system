-- Final interview becomes its own pipeline stage, between Interview and Offer,
-- with its own stage review so it never overwrites the first interview's score.

alter table applications drop constraint if exists applications_stage_check;
alter table applications add constraint applications_stage_check
  check (stage in ('new','screening','interview','final_interview','offer','hired','rejected'));

alter table stage_reviews drop constraint if exists stage_reviews_stage_type_check;
alter table stage_reviews add constraint stage_reviews_stage_type_check
  check (stage_type in ('screening','interview','final_interview'));
