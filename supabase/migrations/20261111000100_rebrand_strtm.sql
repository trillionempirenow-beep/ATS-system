-- Rebrand from the placeholder "Acme" to Strtm.
-- Only values still on the old defaults change: a company name or department
-- description an Admin has already edited is left alone.

update settings set setting_value = 'Strtm'
  where setting_key = 'company_name' and setting_value = 'Acme';

update departments set description = 'Build and scale the Strtm platform'
  where name = 'Engineering' and description = 'Build and scale the Acme platform';
update departments set description = 'Grow awareness and demand for Strtm'
  where name = 'Marketing' and description = 'Grow awareness and demand for Acme';
update departments set description = 'Help customers succeed with Strtm'
  where name = 'Customer Support' and description = 'Help customers succeed with Acme';

alter table interviews alter column meeting_provider set default 'Strtm Room';
update interviews set meeting_provider = 'Strtm Room' where meeting_provider = 'Acme Room';
