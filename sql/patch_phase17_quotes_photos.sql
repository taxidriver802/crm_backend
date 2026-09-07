-- Phase 17: estimate templates + file captions / before-after / portal visibility

CREATE TABLE IF NOT EXISTS estimate_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimate_templates_name
  ON estimate_templates (lower(name));

CREATE TABLE IF NOT EXISTS estimate_template_line_items (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES estimate_templates (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT estimate_template_line_items_quantity_check CHECK (quantity >= 0),
  CONSTRAINT estimate_template_line_items_unit_price_check CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_estimate_template_line_items_template_sort
  ON estimate_template_line_items (template_id, sort_order);

ALTER TABLE files
ADD COLUMN IF NOT EXISTS caption TEXT;

ALTER TABLE files
ADD COLUMN IF NOT EXISTS category TEXT;

UPDATE files
SET category = COALESCE(category, 'other')
WHERE category IS NULL;

ALTER TABLE files
ALTER COLUMN category SET DEFAULT 'other';

ALTER TABLE files
ALTER COLUMN category SET NOT NULL;

ALTER TABLE files
DROP CONSTRAINT IF EXISTS files_category_check;

ALTER TABLE files
ADD CONSTRAINT files_category_check
CHECK (category IN ('before', 'after', 'other'));

ALTER TABLE files
ADD COLUMN IF NOT EXISTS client_visible BOOLEAN;

UPDATE files
SET client_visible = COALESCE(client_visible, TRUE)
WHERE client_visible IS NULL;

ALTER TABLE files
ALTER COLUMN client_visible SET DEFAULT TRUE;

ALTER TABLE files
ALTER COLUMN client_visible SET NOT NULL;

-- Seed roofing templates (idempotent by name)
INSERT INTO estimate_templates (name, description)
SELECT 'Inspection', 'Standard roof inspection visit and written report.'
WHERE NOT EXISTS (SELECT 1 FROM estimate_templates WHERE lower(name) = 'inspection');

INSERT INTO estimate_templates (name, description)
SELECT 'Repair', 'Typical leak or flashing repair package.'
WHERE NOT EXISTS (SELECT 1 FROM estimate_templates WHERE lower(name) = 'repair');

INSERT INTO estimate_templates (name, description)
SELECT 'Replacement', 'Full roof replacement starter package.'
WHERE NOT EXISTS (SELECT 1 FROM estimate_templates WHERE lower(name) = 'replacement');

INSERT INTO estimate_templates (name, description)
SELECT 'Gutters', 'Seamless gutter and downspout install.'
WHERE NOT EXISTS (SELECT 1 FROM estimate_templates WHERE lower(name) = 'gutters');

INSERT INTO estimate_templates (name, description)
SELECT 'Maintenance', 'Seasonal clean-out and minor sealing.'
WHERE NOT EXISTS (SELECT 1 FROM estimate_templates WHERE lower(name) = 'maintenance');

INSERT INTO estimate_template_line_items (template_id, name, description, quantity, unit_price, sort_order)
SELECT t.id, v.name, v.description, v.quantity, v.unit_price, v.sort_order
FROM estimate_templates t
CROSS JOIN (
  VALUES
    ('Roof inspection', 'On-site inspection of roof system', 1, 250, 0),
    ('Written condition report', 'Summary of findings and recommendations', 1, 75, 1)
) AS v(name, description, quantity, unit_price, sort_order)
WHERE lower(t.name) = 'inspection'
  AND NOT EXISTS (
    SELECT 1 FROM estimate_template_line_items i WHERE i.template_id = t.id
  );

INSERT INTO estimate_template_line_items (template_id, name, description, quantity, unit_price, sort_order)
SELECT t.id, v.name, v.description, v.quantity, v.unit_price, v.sort_order
FROM estimate_templates t
CROSS JOIN (
  VALUES
    ('Leak repair labor', 'Locate and repair active leaks', 1, 450, 0),
    ('Flashing and materials', 'Pipe boots, sealant, and flashing', 1, 185, 1),
    ('Debris removal', 'Haul-off of repair debris', 1, 95, 2)
) AS v(name, description, quantity, unit_price, sort_order)
WHERE lower(t.name) = 'repair'
  AND NOT EXISTS (
    SELECT 1 FROM estimate_template_line_items i WHERE i.template_id = t.id
  );

INSERT INTO estimate_template_line_items (template_id, name, description, quantity, unit_price, sort_order)
SELECT t.id, v.name, v.description, v.quantity, v.unit_price, v.sort_order
FROM estimate_templates t
CROSS JOIN (
  VALUES
    ('Tear-off', 'Remove existing roofing to deck', 1, 1200, 0),
    ('Underlayment', 'Synthetic underlayment', 1, 650, 1),
    ('Architectural shingles', 'Laminate shingle install', 1, 4200, 2),
    ('Ridge cap and vents', 'Ridge, pipe boots, and ventilation', 1, 380, 3),
    ('Labor', 'Install labor', 1, 2800, 4)
) AS v(name, description, quantity, unit_price, sort_order)
WHERE lower(t.name) = 'replacement'
  AND NOT EXISTS (
    SELECT 1 FROM estimate_template_line_items i WHERE i.template_id = t.id
  );

INSERT INTO estimate_template_line_items (template_id, name, description, quantity, unit_price, sort_order)
SELECT t.id, v.name, v.description, v.quantity, v.unit_price, v.sort_order
FROM estimate_templates t
CROSS JOIN (
  VALUES
    ('Seamless gutters', 'Linear feet of 5" or 6" gutter', 120, 12, 0),
    ('Downspouts', 'Each downspout and outlet', 4, 45, 1),
    ('Hang and seal', 'Install, hangers, and end caps', 1, 350, 2)
) AS v(name, description, quantity, unit_price, sort_order)
WHERE lower(t.name) = 'gutters'
  AND NOT EXISTS (
    SELECT 1 FROM estimate_template_line_items i WHERE i.template_id = t.id
  );

INSERT INTO estimate_template_line_items (template_id, name, description, quantity, unit_price, sort_order)
SELECT t.id, v.name, v.description, v.quantity, v.unit_price, v.sort_order
FROM estimate_templates t
CROSS JOIN (
  VALUES
    ('Debris clean-out', 'Roof and gutter debris removal', 1, 175, 0),
    ('Sealant and minor repairs', 'Touch-up sealing at penetrations', 1, 125, 1)
) AS v(name, description, quantity, unit_price, sort_order)
WHERE lower(t.name) = 'maintenance'
  AND NOT EXISTS (
    SELECT 1 FROM estimate_template_line_items i WHERE i.template_id = t.id
  );
