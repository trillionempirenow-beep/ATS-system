-- DEVELOPMENT DATA ONLY. Loaded automatically by `npm run dev:db` into an empty
-- local database. Never run this against production.
--
-- Every account's password is: password
-- (the same bcrypt $2y$ hash the PHP system seeded, which proves imported PHP
-- password hashes keep working).

insert into users (id, name, email, password_hash, role, active, account_status, created_by, hr_account_limit, job_title, approved_at) values
  (1, 'Sam Okafor',     'superadmin@acme.test', '$2y$10$d0ujHW5.pW4VY.wERrByzeGBmCDQrkkpzTlPawcHAnvQcA1iylBgS', 'super_admin',    true,  'active',  null, 0, 'Head of People Systems', now()),
  (2, 'Alicia Moreno',  'admin@acme.test',      '$2y$10$d0ujHW5.pW4VY.wERrByzeGBmCDQrkkpzTlPawcHAnvQcA1iylBgS', 'admin',          true,  'active',  1,    5, 'Talent Operations Lead', now()),
  (3, 'Daniel Reyes',   'recruiter@acme.test',  '$2y$10$d0ujHW5.pW4VY.wERrByzeGBmCDQrkkpzTlPawcHAnvQcA1iylBgS', 'recruiter',      true,  'active',  2,    0, 'Senior Recruiter', now()),
  (4, 'Priya Natarajan','manager@acme.test',    '$2y$10$d0ujHW5.pW4VY.wERrByzeGBmCDQrkkpzTlPawcHAnvQcA1iylBgS', 'hiring_manager', true,  'active',  2,    0, 'Engineering Manager', now()),
  (5, 'Marco Bianchi',  'employee@acme.test',   '$2y$10$d0ujHW5.pW4VY.wERrByzeGBmCDQrkkpzTlPawcHAnvQcA1iylBgS', 'employee',       true,  'active',  2,    0, 'Support Specialist', now()),
  (6, 'Hana Kim',       'hana.kim@acme.test',   '$2y$10$d0ujHW5.pW4VY.wERrByzeGBmCDQrkkpzTlPawcHAnvQcA1iylBgS', 'recruiter',      false, 'pending', 2,    0, 'Recruiter', null),
  (7, 'Leo Martins',    'leo.martins@acme.test','$2y$10$d0ujHW5.pW4VY.wERrByzeGBmCDQrkkpzTlPawcHAnvQcA1iylBgS', 'recruiter',      false, 'suspended', 2,  0, 'Sourcer', now());
select setval(pg_get_serial_sequence('users','id'), 20);

insert into user_permissions (user_id, permission, granted_by) values
  (2,'manage_accounts',1),(2,'job_management',1),(2,'job_posting',1),(2,'audit_trail',1),(2,'applicant_portal',1),
  (3,'job_management',2),(3,'job_posting',2),(3,'audit_trail',2),
  (6,'job_management',2),(7,'job_management',2);

insert into jobs (id, department_id, title, slug, location, employment_type, tags, applicant_limit, description, requirements, responsibilities, is_urgent, status, approval_status, owner_id, created_by, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note, salary_info, published_at, created_at) values
  (1, (select id from departments where name='Engineering'), 'Senior Product Engineer', 'senior-product-engineer', 'Remote / Manila', 'full_time', 'React,TypeScript,Node.js', 30,
   'Build the future of work with a thoughtful engineering team. You will own features end to end, from design review to production.',
   E'5+ years building production web applications\nStrong experience with React and TypeScript\nComfortable owning features end-to-end, from design to deploy\nClear written and verbal communication in an async, remote-first team',
   E'Ship product features across the web app\nReview code and mentor engineers\nPartner with design on interaction details', true, 'open', 'approved', 3, 3, 3, now() - interval '20 days', 2, now() - interval '19 days', null, 'PHP 180k–240k / month', now() - interval '19 days', now() - interval '21 days'),
  (2, (select id from departments where name='Design'), 'Product Designer', 'product-designer', 'Remote', 'full_time', 'Figma,Research,Prototyping', null,
   'Shape how thousands of people hire. You will run research, design flows and ship polished interfaces with engineering.',
   E'3+ years designing web products\nA portfolio showing end-to-end process\nComfort running usability sessions', null, false, 'open', 'approved', 3, 3, 3, now() - interval '15 days', 2, now() - interval '14 days', null, null, now() - interval '14 days', now() - interval '16 days'),
  (3, (select id from departments where name='Engineering'), 'DevOps Engineer', 'devops-engineer', 'Manila', 'full_time', 'AWS,Kubernetes,Terraform', 5,
   'Keep our platform fast, observable and boring in the best way.', E'Experience running Kubernetes in production\nInfrastructure as code with Terraform', null, true, 'open', 'approved', 2, 2, null, null, 2, now() - interval '10 days', null, null, now() - interval '10 days', now() - interval '10 days'),
  (4, (select id from departments where name='Customer Support'), 'Customer Success Lead', 'customer-success-lead', 'Cebu', 'full_time', 'SaaS,Onboarding', null,
   'Lead a team that helps customers get value from Acme in their first 90 days.', E'Team leadership experience\nSaaS onboarding background', null, false, 'draft', 'pending', 3, 3, 3, now() - interval '2 hours', null, null, null, null, null, now() - interval '1 day'),
  (5, (select id from departments where name='Marketing'), 'Content Marketer', 'content-marketer', 'Remote', 'contract', 'Writing,SEO', null,
   'Tell the Acme story through long-form content.', E'Portfolio of published writing', null, false, 'draft', 'changes_requested', 3, 3, 3, now() - interval '3 days', 2, now() - interval '2 days', 'Please add the salary range and clarify the contract length.', null, null, now() - interval '4 days'),
  (6, (select id from departments where name='Finance'), 'Financial Analyst', 'financial-analyst', 'Manila', 'full_time', 'Excel,Modelling', null,
   'Own monthly reporting and planning models.', E'CPA or equivalent\n2+ years in FP&A', null, false, 'closed', 'approved', 2, 2, null, null, 2, now() - interval '60 days', null, null, now() - interval '60 days', now() - interval '61 days'),
  (7, (select id from departments where name='Operations'), 'Operations Analyst', 'operations-analyst', 'Manila', 'part_time', 'SQL,Reporting', null,
   'Help us run a tighter operation with better data.', E'SQL fluency', null, false, 'draft', 'draft', 3, 3, null, null, null, null, null, null, null, now() - interval '5 hours');
select setval(pg_get_serial_sequence('jobs','id'), 20);

insert into job_approvals (job_id, actor_id, action, note, created_at) values
  (1,3,'submitted',null, now() - interval '20 days'), (1,2,'approved',null, now() - interval '19 days'), (1,2,'published',null, now() - interval '19 days'),
  (2,3,'submitted',null, now() - interval '15 days'), (2,2,'approved',null, now() - interval '14 days'), (2,2,'published',null, now() - interval '14 days'),
  (3,2,'published','Created and published by an Admin', now() - interval '10 days'),
  (4,3,'submitted',null, now() - interval '2 hours'),
  (5,3,'submitted',null, now() - interval '3 days'), (5,2,'changes_requested','Please add the salary range and clarify the contract length.', now() - interval '2 days');

insert into candidates (id, first_name, last_name, email, phone, current_title, experience_level, skills, source, rating, consent_at, created_at, resume_text) values
  (1,'Maya','Chen','maya.chen@example.com','+63 917 555 0101','Frontend Engineer','senior','react, typescript, graphql','linkedin',4, now() - interval '12 days', now() - interval '12 days', 'Maya Chen Frontend Engineer 7 years React TypeScript GraphQL design systems'),
  (2,'Jonas','Weber','jonas.weber@example.com','+49 151 555 0102','Product Designer','mid','figma, research','company_website',5, now() - interval '9 days', now() - interval '9 days', 'Jonas Weber product designer figma research prototyping checkout redesign'),
  (3,'Kwame','Mensah','kwame.mensah@example.com','+233 20 555 0103','Site Reliability Engineer','senior','aws, kubernetes, terraform','referral',4, now() - interval '8 days', now() - interval '8 days', 'Kwame Mensah SRE AWS Kubernetes Terraform on-call'),
  (4,'Sofia','Rossi','sofia.rossi@example.com','+39 333 555 0104','Staff Engineer','lead','react, node.js, postgresql','linkedin',5, now() - interval '30 days', now() - interval '30 days', null),
  (5,'Luis','Fernandez','luis.fernandez@example.com','+63 917 555 0105','Support Lead','mid','zendesk, onboarding','indeed',0, now() - interval '2 days', now() - interval '2 days', null),
  (6,'Nora','Haddad','nora.haddad@example.com','+971 50 555 0106','UX Designer','mid','figma, prototyping','jobstreet',3, now() - interval '20 minutes', now() - interval '20 minutes', null),
  (7,'Tomás','Silva','tomas.silva@example.com','+351 91 555 0107','Full-stack Developer','mid','javascript, react, php','google',3, now() - interval '6 days', now() - interval '6 days', null),
  (8,'Elena','Petrova','elena.petrova@example.com','+359 88 555 0108','Platform Engineer','senior','kubernetes, go','linkedin',0, now() - interval '4 days', now() - interval '4 days', null),
  (9,'Ravi','Menon','ravi.menon@example.com','+91 98 555 0109','Junior Developer','entry','javascript, html, css','university',2, now() - interval '1 day', now() - interval '1 day', null),
  (10,'Amara','Okafor','amara.okafor@example.com','+234 80 555 0110','Senior Frontend Engineer','senior','react, typescript','referral',4, now() - interval '18 days', now() - interval '18 days', null),
  (11,'Pedro','Alves','pedro.alves@example.com','+55 11 555 0111','Designer','entry','illustrator','other',1, now() - interval '25 days', now() - interval '25 days', null);
select setval(pg_get_serial_sequence('candidates','id'), 50);

insert into applications (id, candidate_id, job_id, stage, status, cover_letter, why_us, assigned_to, applied_at, updated_at) values
  (1,1,1,'screening','active','I have led the migration of a large React codebase to TypeScript and care about performance.','Acme builds tools I would use myself.',3, now() - interval '12 days', now() - interval '2 days'),
  (2,2,2,'interview','active','I redesigned a checkout flow that cut drop-off by a third.','Your hiring product is humane.',3, now() - interval '9 days', now() - interval '1 day'),
  (3,3,3,'interview','active','I run Kubernetes clusters for a fintech with 99.99% uptime.','I like boring infrastructure.',4, now() - interval '8 days', now() - interval '1 day'),
  (4,4,1,'hired','active','Staff engineer with a decade of React and Node.js.','Mission and team.',3, now() - interval '30 days', now() - interval '3 days'),
  (5,5,4,'new','active','I have onboarded 200+ SaaS customers.','Customer success matters here.',null, now() - interval '2 days', now() - interval '2 days'),
  (6,6,2,'new','active','Designer who loves research.','I use Acme at work.',null, now() - interval '20 minutes', now() - interval '20 minutes'),
  (7,7,1,'screening','active','Full-stack developer, PHP to TypeScript.','Growth.',3, now() - interval '6 days', now() - interval '4 days'),
  (8,8,3,'screening','active','Platform engineer, Go and Kubernetes.','Scale.',4, now() - interval '4 days', now() - interval '3 days'),
  (9,9,1,'new','active','Recent graduate with internship experience in React.','Learning culture.',null, now() - interval '1 day', now() - interval '1 day'),
  (10,10,1,'offer','active','Senior frontend engineer with design-system experience.','Product quality.',3, now() - interval '18 days', now() - interval '2 days'),
  (11,11,2,'rejected','active','Junior designer.','Portfolio growth.',3, now() - interval '25 days', now() - interval '10 days'),
  (12,7,2,'new','withdrawn','Interested in design engineering too.','Variety.',null, now() - interval '5 days', now() - interval '4 days');
select setval(pg_get_serial_sequence('applications','id'), 50);

insert into candidate_notes (candidate_id, author_id, note, created_at) values
  (1,3,'Strong portfolio of design-system work. Ask about accessibility testing in the interview.', now() - interval '3 days'),
  (2,3,'Great research depth. Portfolio link is excellent.', now() - interval '2 days'),
  (3,4,'Clear on-call experience. Check salary expectations.', now() - interval '1 day');

insert into candidate_feedback (application_id, author_id, fit, notes, created_at) values
  (11,3,'not-a-fit','We are looking for more product design experience for this role, but your illustration work is strong.', now() - interval '10 days');
insert into candidate_role_suggestions (application_id, suggested_job_id, note, author_id, created_at) values
  (11,5,'Your visual storytelling could suit our content team.',3, now() - interval '10 days');

insert into stage_reviews (application_id, stage_type, rating, feedback, notes, reviewer_id) values
  (1,'screening',78,'Solid communication, clear React depth.','Recorded during the screening call.',3),
  (10,'interview',88,'Excellent system design discussion.',null,3),
  (4,'interview',92,'Outstanding technical leadership.',null,3);

insert into interviews (id, application_id, interviewer_id, meeting_type, starts_at, ends_at, interview_type, meeting_provider, room_code, candidate_token, status, meeting_state, live_notes, score, feedback, recommendation, started_at, ended_at, reviewed_at, reviewer_id, created_by, created_at) values
  (1,2,3,'interview', now() + interval '10 minutes', now() + interval '55 minutes', 'video','Acme Room','ACM4F7K2','3f9a1c2e7b8d4e5f6a7b8c9d0e1f2a3b','scheduled','scheduled',null,null,null,null,null,null,null,null,3, now() - interval '1 day'),
  (2,3,4,'interview', now() + interval '1 day 2 hours', now() + interval '1 day 3 hours', 'panel','Acme Room','ACM9Q2LX','8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e','scheduled','scheduled',null,null,null,null,null,null,null,null,4, now() - interval '1 day'),
  (3,1,3,'screening', now() + interval '2 days', now() + interval '2 days 30 minutes', 'video','Acme Room','ACM7H3RD','a1b2c3d4e5f60718293a4b5c6d7e8f90','scheduled','scheduled',null,null,null,null,null,null,null,null,3, now() - interval '2 days'),
  (4,10,3,'interview', now() - interval '3 days', now() - interval '3 days' + interval '45 minutes', 'video','Acme Room','ACM2KD8P','0f1e2d3c4b5a69788796a5b4c3d2e1f0','completed','reviewed','Deep React knowledge. Asked about design tokens.',88,'Excellent system design discussion.','offer', now() - interval '3 days', now() - interval '3 days' + interval '44 minutes', now() - interval '3 days' + interval '2 hours',3,3, now() - interval '6 days'),
  (5,7,3,'screening', now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', 'phone','Phone',null,null,'completed','review_pending','Good background; confirm notice period.',null,null,null, now() - interval '1 day', now() - interval '1 day' + interval '28 minutes', null,null,3, now() - interval '3 days');
select setval(pg_get_serial_sequence('interviews','id'), 50);

insert into candidate_ai_analysis (application_id, overall_score, category_scores, summary, strengths, concerns, recommendation, ai_notes) values
  (1, 82, '{"Skills Match":88,"Experience":80,"Education":74,"Application Quality":82,"Communication":85}',
   'The candidate presents a strong match for the Senior Product Engineer position based on their application. Their responses reflect relevant preparation and reasonable alignment with what the role calls for.',
   '["Strong overlap between the application content and this role''s listed requirements","Clear, articulate written communication"]',
   '["No significant concerns identified from the application alone — verify further during screening"]',
   'Recommended for Interview', 'Candidate demonstrates strong alignment with the Senior Product Engineer position.');

insert into employees (id, user_id, candidate_id, application_id, applied_position, employee_number, job_title, department_id, start_date, status) values
  (1, null, 4, 4, 'Senior Product Engineer', 'EMP-2026-0004', 'Senior Product Engineer', (select id from departments where name='Engineering'), current_date + 7, 'active'),
  (2, 5, null, null, null, 'EMP-1017', 'Support Specialist', (select id from departments where name='Customer Support'), current_date - 400, 'active'),
  (3, null, null, null, null, 'EMP-0952', 'QA Engineer', (select id from departments where name='Engineering'), current_date - 700, 'terminated');
select setval(pg_get_serial_sequence('employees','id'), 20);

insert into attendance_records (employee_id, work_date, clock_in, clock_out, worked_minutes, status) values
  (2, current_date - 1, (current_date - 1) + time '08:58', (current_date - 1) + time '18:04', 546, 'present'),
  (2, current_date - 2, (current_date - 2) + time '09:14', (current_date - 2) + time '18:10', 536, 'late'),
  (2, current_date - 3, (current_date - 3) + time '08:51', (current_date - 3) + time '12:40', 229, 'half_day');

insert into notifications (user_id, actor_id, type, category, priority, title, body, link, action_label, created_at) values
  (2,3,'job_approval','application','high','Job approval required','Daniel Reyes submitted "Customer Success Lead" for approval.','/app/jobs/approvals/4','Review posting', now() - interval '2 hours'),
  (3,null,'application_received','application','medium','New application','Nora Haddad applied for Product Designer.','/app/candidates/6','Open candidate', now() - interval '20 minutes'),
  (3,2,'job_decision','application','medium','Changes requested on your job posting','"Content Marketer": Please add the salary range and clarify the contract length.','/app/jobs/5/edit','Edit posting', now() - interval '2 days'),
  (1,2,'account_approval','system','medium','HR/Recruiter account needs approval','Alicia Moreno created an account for Hana Kim.','/app/admin/users?status=pending','Review account', now() - interval '1 day');

insert into password_reset_requests (user_id, reason, status, requested_ip, created_at) values
  (4, 'Locked out after changing phones.', 'pending', '127.0.0.1', now() - interval '3 hours');

insert into referrals (referrer_name, referrer_email, candidate_name, candidate_email, job_id, notes) values
  ('Marco Bianchi','employee@acme.test','Ana Lopez','ana.lopez@example.com',1,'Worked with Ana at my last company.');

insert into audit_logs (user_id, action, entity_type, entity_id, details, ip_address, created_at) values
  (3,'pipeline_stage_move','application',2,'{"from":"screening","to":"interview","override":false}','127.0.0.1', now() - interval '1 day'),
  (3,'interview_create','interview',1,null,'127.0.0.1', now() - interval '1 day'),
  (2,'job_request_changes','job',5,'{"title":"Content Marketer","requested":"Please add the salary range and clarify the contract length."}','127.0.0.1', now() - interval '2 days'),
  (3,'interview_review_submitted','interview',4,'{"meeting":"Interview","score":"88/100","recommendation":"Proceed to offer"}','127.0.0.1', now() - interval '3 days'),
  (3,'candidate_note','candidate',1,null,'127.0.0.1', now() - interval '3 days');
