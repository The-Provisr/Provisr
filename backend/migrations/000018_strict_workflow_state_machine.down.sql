-- OR-006 changes persisted state labels. Reversing it would lose the extra
-- distinction between manifest creation and validation, so it is intentionally
-- irreversible after application data has been written.
SELECT 1;
