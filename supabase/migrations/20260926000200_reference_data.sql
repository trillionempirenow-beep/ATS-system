-- Reference data every install needs. Mirrors the INSERTs in the PHP schema.sql
-- and migrations (settings defaults, departments, the standard work schedule).
-- No user accounts are created here: see supabase/seed.sql for development data.

insert into settings (setting_key, setting_value) values
  ('company_name', 'Acme'),
  ('careers_headline', 'Do the best work of your career.'),
  ('default_applicant_limit', ''),
  ('logo_path', ''),
  ('attendance_timezone', 'Asia/Manila'),
  ('attendance_grace_minutes', '10'),
  ('candidate_required_fields', '["full_name","email"]'),
  ('interview_join_window_minutes', '15'),
  ('password_reset_hours', '24'),
  ('meeting_presence_seconds', '35'),
  ('portal_accepting_applications', '1'),
  ('portal_closed_message', ''),
  ('interview_reminder_minutes', '60'),
  ('ice_servers', '[{"urls":"stun:stun.l.google.com:19302"}]')
on conflict (setting_key) do nothing;

insert into departments (name, description) values
  ('Engineering', 'Build and scale the Acme platform'),
  ('Design', 'Make complex things feel simple'),
  ('People', 'Support an exceptional employee experience'),
  ('Finance', 'Manage budgets, payments, and reporting'),
  ('Marketing', 'Grow awareness and demand for Acme'),
  ('Operations', 'Keep the business running smoothly'),
  ('Sales', 'Bring in new customers and revenue'),
  ('Customer Support', 'Help customers succeed with Acme')
on conflict (name) do nothing;

insert into work_schedules (name) values ('Standard 9 to 6') on conflict (name) do nothing;
