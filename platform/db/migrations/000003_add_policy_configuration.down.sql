ALTER TABLE organizations
    DROP COLUMN IF EXISTS required_tags,
    DROP COLUMN IF EXISTS allowed_regions;
