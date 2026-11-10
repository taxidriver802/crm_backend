-- Personal workspace: density, which desk opens first, and the job pane
-- someone last used. Preferences belong to the user, not the company.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS ui_preferences JSONB;

UPDATE users
SET ui_preferences = '{}'::jsonb
WHERE ui_preferences IS NULL;

ALTER TABLE users
ALTER COLUMN ui_preferences SET DEFAULT '{}'::jsonb;

ALTER TABLE users
ALTER COLUMN ui_preferences SET NOT NULL;
