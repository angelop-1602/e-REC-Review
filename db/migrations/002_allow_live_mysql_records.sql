-- Allow records created after the one-time Firestore import to exist without
-- pretending they belong to a Firestore migration run.

USE erec_review;

ALTER TABLE protocols
  MODIFY migration_run_id BIGINT UNSIGNED NULL;

ALTER TABLE protocol_reviewer_assignments
  MODIFY migration_run_id BIGINT UNSIGNED NULL;

INSERT INTO schema_migrations (version, description)
VALUES ('002', 'Allow native MySQL protocol and assignment records');
