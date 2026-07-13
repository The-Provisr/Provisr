ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS allowed_regions TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS required_tags TEXT[] NOT NULL DEFAULT '{}';
