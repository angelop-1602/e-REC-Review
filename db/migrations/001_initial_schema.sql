-- e-REC Review initial MySQL schema
-- Target: MySQL 8.4

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS erec_review
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE erec_review;

CREATE TABLE schema_migrations (
  version VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL,
  checksum_sha256 BINARY(32) NULL,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (version)
) ENGINE = InnoDB;

CREATE TABLE migration_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_label VARCHAR(80) NOT NULL,
  source_project_id VARCHAR(128) NOT NULL,
  source_database_id VARCHAR(128) NOT NULL,
  source_git_commit CHAR(40) NULL,
  backup_started_at DATETIME(6) NULL,
  backup_completed_at DATETIME(6) NULL,
  import_started_at DATETIME(6) NULL,
  import_completed_at DATETIME(6) NULL,
  manifest_sha256 BINARY(32) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  source_document_count INT UNSIGNED NULL,
  imported_document_count INT UNSIGNED NOT NULL DEFAULT 0,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_migration_runs_snapshot (
    source_project_id,
    source_database_id,
    snapshot_label
  ),
  CONSTRAINT chk_migration_runs_status CHECK (
    status IN ('pending', 'importing', 'validated', 'failed')
  )
) ENGINE = InnoDB;

-- Immutable source archive. JSON is intentionally limited to this raw lineage
-- table so tagged Firestore values remain recoverable after normalization.
CREATE TABLE firestore_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  migration_run_id BIGINT UNSIGNED NOT NULL,
  source_path VARCHAR(1024) NOT NULL,
  source_path_sha256 BINARY(32) NOT NULL,
  source_document_id VARCHAR(255) NOT NULL,
  parent_path VARCHAR(1024) NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  payload_sha256 BINARY(32) NOT NULL,
  imported_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_firestore_documents_source (
    migration_run_id,
    source_path_sha256
  ),
  KEY ix_firestore_documents_group (source_kind, source_name),
  CONSTRAINT fk_firestore_documents_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE reviewers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  access_code VARCHAR(64) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(320) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_document_id VARCHAR(255) NULL,
  source_path VARCHAR(1024) NULL,
  source_path_sha256 BINARY(32) NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviewers_access_code (access_code),
  UNIQUE KEY uq_reviewers_email (email),
  UNIQUE KEY uq_reviewers_source (migration_run_id, source_path_sha256),
  KEY ix_reviewers_name (full_name),
  KEY ix_reviewers_active (is_active, deleted_at),
  CONSTRAINT fk_reviewers_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE reviewer_aliases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  alias_value VARCHAR(255) NOT NULL,
  normalized_alias VARCHAR(255) NOT NULL,
  alias_type VARCHAR(24) NOT NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviewer_aliases_normalized (normalized_alias),
  KEY ix_reviewer_aliases_reviewer (reviewer_id, deleted_at),
  CONSTRAINT chk_reviewer_aliases_type CHECK (
    alias_type IN ('access_code', 'canonical_name', 'legacy', 'manual')
  ),
  CONSTRAINT fk_reviewer_aliases_reviewer
    FOREIGN KEY (reviewer_id) REFERENCES reviewers (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_reviewer_aliases_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE protocol_months (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  legacy_month_key VARCHAR(32) NOT NULL,
  calendar_year SMALLINT UNSIGNED NOT NULL,
  calendar_month TINYINT UNSIGNED NOT NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_protocol_months_calendar (calendar_year, calendar_month),
  UNIQUE KEY uq_protocol_months_legacy_key (legacy_month_key),
  KEY ix_protocol_months_sort (calendar_year DESC, calendar_month DESC),
  CONSTRAINT chk_protocol_months_month CHECK (calendar_month BETWEEN 1 AND 12),
  CONSTRAINT fk_protocol_months_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE protocol_weeks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  protocol_month_id BIGINT UNSIGNED NOT NULL,
  week_number TINYINT UNSIGNED NOT NULL,
  legacy_week_key VARCHAR(16) NOT NULL,
  legacy_collection_path VARCHAR(1024) NULL,
  legacy_collection_path_sha256 BINARY(32) NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_protocol_weeks_month_number (protocol_month_id, week_number),
  UNIQUE KEY uq_protocol_weeks_source (
    migration_run_id,
    legacy_collection_path_sha256
  ),
  CONSTRAINT chk_protocol_weeks_number CHECK (week_number BETWEEN 1 AND 5),
  CONSTRAINT fk_protocol_weeks_month
    FOREIGN KEY (protocol_month_id) REFERENCES protocol_months (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_weeks_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE review_form_types (
  code VARCHAR(32) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  form_url VARCHAR(2048) NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (code)
) ENGINE = InnoDB;

CREATE TABLE protocols (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  protocol_week_id BIGINT UNSIGNED NOT NULL,
  rec_code VARCHAR(100) NOT NULL,
  research_title TEXT NOT NULL,
  principal_investigator VARCHAR(500) NOT NULL DEFAULT '',
  adviser VARCHAR(500) NOT NULL DEFAULT '',
  course_program VARCHAR(255) NOT NULL DEFAULT '',
  document_link TEXT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'in_progress',
  due_date DATE NULL,
  completed_at DATETIME(6) NULL,
  source_status VARCHAR(32) NULL,
  source_completed_at DATETIME(6) NULL,
  source_created_at DATETIME(6) NULL,
  source_updated_at DATETIME(6) NULL,
  source_document_id VARCHAR(255) NOT NULL,
  source_path VARCHAR(1024) NOT NULL,
  source_path_sha256 BINARY(32) NOT NULL,
  migration_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_protocols_week_rec_code (protocol_week_id, rec_code),
  UNIQUE KEY uq_protocols_source (migration_run_id, source_path_sha256),
  KEY ix_protocols_rec_code (rec_code),
  KEY ix_protocols_week_status (protocol_week_id, status, deleted_at),
  FULLTEXT KEY fx_protocols_search (
    rec_code,
    research_title,
    principal_investigator
  ),
  CONSTRAINT chk_protocols_status CHECK (
    status IN ('in_progress', 'completed')
  ),
  CONSTRAINT fk_protocols_week
    FOREIGN KEY (protocol_week_id) REFERENCES protocol_weeks (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocols_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE protocol_reviewer_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  protocol_id BIGINT UNSIGNED NOT NULL,
  assignment_slot SMALLINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NULL,
  source_reviewer_id VARCHAR(255) NOT NULL,
  source_reviewer_name VARCHAR(255) NOT NULL,
  form_type_code VARCHAR(32) NULL,
  source_form_type VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL,
  due_date DATE NULL,
  completed_at DATETIME(6) NULL,
  source_path VARCHAR(1024) NOT NULL,
  source_path_sha256 BINARY(32) NOT NULL,
  source_ordinal SMALLINT UNSIGNED NOT NULL,
  migration_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_protocol_assignments_slot (protocol_id, assignment_slot),
  UNIQUE KEY uq_protocol_assignments_source (
    migration_run_id,
    source_path_sha256,
    source_ordinal
  ),
  KEY ix_protocol_assignments_reviewer_due (
    reviewer_id,
    status,
    due_date,
    deleted_at
  ),
  KEY ix_protocol_assignments_protocol_status (protocol_id, status, deleted_at),
  CONSTRAINT chk_protocol_assignments_status CHECK (
    status IN ('in_progress', 'completed')
  ),
  CONSTRAINT fk_protocol_assignments_protocol
    FOREIGN KEY (protocol_id) REFERENCES protocols (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_assignments_reviewer
    FOREIGN KEY (reviewer_id) REFERENCES reviewers (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_assignments_form_type
    FOREIGN KEY (form_type_code) REFERENCES review_form_types (code)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_assignments_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Every automatic or manual reviewer match is recorded, including unresolved
-- identities. The normalized assignment keeps the original ID and name too.
CREATE TABLE reviewer_identity_resolutions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  migration_run_id BIGINT UNSIGNED NOT NULL,
  source_path VARCHAR(1024) NOT NULL,
  source_path_sha256 BINARY(32) NOT NULL,
  source_ordinal SMALLINT UNSIGNED NOT NULL,
  source_reviewer_id VARCHAR(255) NOT NULL,
  source_reviewer_name VARCHAR(255) NOT NULL,
  normalized_id VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  matched_reviewer_id BIGINT UNSIGNED NULL,
  match_method VARCHAR(32) NOT NULL,
  decision_note VARCHAR(500) NULL,
  decided_by VARCHAR(128) NULL,
  decided_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviewer_identity_resolutions_source (
    migration_run_id,
    source_path_sha256,
    source_ordinal
  ),
  KEY ix_reviewer_identity_resolutions_unresolved (
    matched_reviewer_id,
    match_method
  ),
  CONSTRAINT chk_reviewer_identity_resolutions_method CHECK (
    match_method IN (
      'exact_access_code',
      'exact_canonical_name',
      'registered_alias',
      'manual',
      'unresolved'
    )
  ),
  CONSTRAINT fk_reviewer_identity_resolutions_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_reviewer_identity_resolutions_reviewer
    FOREIGN KEY (matched_reviewer_id) REFERENCES reviewers (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE protocol_assignment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  protocol_id BIGINT UNSIGNED NOT NULL,
  assignment_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(32) NOT NULL,
  from_reviewer_id BIGINT UNSIGNED NULL,
  to_reviewer_id BIGINT UNSIGNED NULL,
  source_from_name VARCHAR(255) NULL,
  source_to_name VARCHAR(255) NULL,
  status_after VARCHAR(24) NULL,
  occurred_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  actor_type VARCHAR(24) NOT NULL DEFAULT 'unknown',
  actor_identifier VARCHAR(255) NULL,
  source_document_id VARCHAR(255) NULL,
  source_path VARCHAR(1024) NULL,
  source_path_sha256 BINARY(32) NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_protocol_assignment_events_source (
    migration_run_id,
    source_path_sha256
  ),
  KEY ix_protocol_assignment_events_protocol (protocol_id, occurred_at DESC),
  KEY ix_protocol_assignment_events_assignment (assignment_id, occurred_at DESC),
  CONSTRAINT chk_protocol_assignment_events_type CHECK (
    event_type IN ('reassignment', 'status_change')
  ),
  CONSTRAINT chk_protocol_assignment_events_status CHECK (
    status_after IS NULL OR status_after IN ('in_progress', 'completed')
  ),
  CONSTRAINT chk_protocol_assignment_events_actor CHECK (
    actor_type IN ('admin', 'reviewer', 'system', 'import', 'unknown')
  ),
  CONSTRAINT fk_protocol_assignment_events_protocol
    FOREIGN KEY (protocol_id) REFERENCES protocols (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_assignment_events_assignment
    FOREIGN KEY (assignment_id) REFERENCES protocol_reviewer_assignments (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_protocol_assignment_events_from_reviewer
    FOREIGN KEY (from_reviewer_id) REFERENCES reviewers (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_assignment_events_to_reviewer
    FOREIGN KEY (to_reviewer_id) REFERENCES reviewers (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_assignment_events_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE notices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(500) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'none',
  published_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NULL,
  source_document_id VARCHAR(255) NULL,
  source_path VARCHAR(1024) NULL,
  source_path_sha256 BINARY(32) NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_notices_source (migration_run_id, source_path_sha256),
  KEY ix_notices_active (expires_at, priority, published_at DESC, deleted_at),
  CONSTRAINT chk_notices_priority CHECK (
    priority IN ('none', 'low', 'medium', 'high')
  ),
  CONSTRAINT fk_notices_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE notice_likes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  notice_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NULL,
  source_reviewer_id VARCHAR(255) NOT NULL,
  source_path VARCHAR(1024) NULL,
  source_path_sha256 BINARY(32) NULL,
  source_ordinal SMALLINT UNSIGNED NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  liked_at DATETIME(6) NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_notice_likes_reviewer (notice_id, source_reviewer_id),
  UNIQUE KEY uq_notice_likes_source (
    migration_run_id,
    source_path_sha256,
    source_ordinal
  ),
  KEY ix_notice_likes_reviewer (reviewer_id, deleted_at),
  CONSTRAINT fk_notice_likes_notice
    FOREIGN KEY (notice_id) REFERENCES notices (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_notice_likes_reviewer
    FOREIGN KEY (reviewer_id) REFERENCES reviewers (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_notice_likes_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE system_notices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  notice_number INT UNSIGNED NOT NULL,
  title VARCHAR(500) NOT NULL,
  subtitle VARCHAR(500) NULL,
  message MEDIUMTEXT NOT NULL,
  action_text VARCHAR(255) NULL,
  action_href VARCHAR(2048) NULL,
  published_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NULL,
  source_document_id VARCHAR(255) NULL,
  source_path VARCHAR(1024) NULL,
  source_path_sha256 BINARY(32) NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_notices_number (notice_number),
  UNIQUE KEY uq_system_notices_source (migration_run_id, source_path_sha256),
  KEY ix_system_notices_active (expires_at, published_at DESC, deleted_at),
  CONSTRAINT fk_system_notices_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE system_notice_key_points (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  system_notice_id BIGINT UNSIGNED NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_notice_key_points_order (
    system_notice_id,
    display_order
  ),
  CONSTRAINT fk_system_notice_key_points_notice
    FOREIGN KEY (system_notice_id) REFERENCES system_notices (id)
    ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE notification_settings (
  singleton_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  frequency VARCHAR(24) NOT NULL DEFAULT 'daily',
  send_to_reviewers BOOLEAN NOT NULL DEFAULT TRUE,
  due_soon_threshold TINYINT UNSIGNED NOT NULL DEFAULT 3,
  last_run_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (singleton_id),
  CONSTRAINT chk_notification_settings_singleton CHECK (singleton_id = 1),
  CONSTRAINT chk_notification_settings_frequency CHECK (
    frequency IN ('daily', 'weekly', 'twice-weekly')
  ),
  CONSTRAINT chk_notification_settings_threshold CHECK (
    due_soon_threshold BETWEEN 1 AND 14
  )
) ENGINE = InnoDB;

CREATE TABLE mail_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  legacy_id VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL,
  scope VARCHAR(24) NOT NULL,
  notification_type VARCHAR(24) NULL,
  subject VARCHAR(500) NOT NULL DEFAULT '',
  source VARCHAR(64) NOT NULL,
  protocol_month_id BIGINT UNSIGNED NULL,
  protocol_week_id BIGINT UNSIGNED NULL,
  legacy_month_key VARCHAR(32) NOT NULL DEFAULT '',
  legacy_week_key VARCHAR(16) NOT NULL DEFAULT '',
  period_label VARCHAR(255) NOT NULL,
  reminder_date DATE NULL,
  due_soon_threshold TINYINT UNSIGNED NULL,
  reviewer_count INT UNSIGNED NOT NULL DEFAULT 0,
  protocol_count INT UNSIGNED NOT NULL DEFAULT 0,
  total INT UNSIGNED NOT NULL DEFAULT 0,
  pending INT UNSIGNED NOT NULL DEFAULT 0,
  sending INT UNSIGNED NOT NULL DEFAULT 0,
  sent INT UNSIGNED NOT NULL DEFAULT 0,
  skipped INT UNSIGNED NOT NULL DEFAULT 0,
  failed INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  source_created_at DATETIME(6) NULL,
  source_updated_at DATETIME(6) NULL,
  source_path VARCHAR(1024) NULL,
  source_path_sha256 BINARY(32) NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  archived_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_batches_legacy_id (legacy_id),
  UNIQUE KEY uq_mail_batches_source (migration_run_id, source_path_sha256),
  KEY ix_mail_batches_created (source_created_at DESC),
  KEY ix_mail_batches_status (status, source_created_at DESC, archived_at),
  CONSTRAINT chk_mail_batches_status CHECK (
    status IN (
      'pending',
      'sending',
      'completed',
      'completed_with_errors',
      'failed'
    )
  ),
  CONSTRAINT chk_mail_batches_scope CHECK (
    scope IN ('week', 'month', 'reminder')
  ),
  CONSTRAINT chk_mail_batches_notification_type CHECK (
    notification_type IS NULL OR notification_type IN ('assignment', 'reminder')
  ),
  CONSTRAINT fk_mail_batches_month
    FOREIGN KEY (protocol_month_id) REFERENCES protocol_months (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_mail_batches_week
    FOREIGN KEY (protocol_week_id) REFERENCES protocol_weeks (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_mail_batches_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE mail_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mail_batch_id BIGINT UNSIGNED NOT NULL,
  legacy_id VARCHAR(255) NULL,
  reviewer_id BIGINT UNSIGNED NULL,
  requested_reviewer_id VARCHAR(255) NOT NULL,
  recipient_name VARCHAR(255) NOT NULL,
  recipient_email VARCHAR(320) NOT NULL DEFAULT '',
  email_match_source VARCHAR(24) NULL,
  status VARCHAR(24) NOT NULL,
  subject VARCHAR(500) NOT NULL DEFAULT '',
  protocol_count INT UNSIGNED NOT NULL DEFAULT 0,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
  external_message_id VARCHAR(998) NULL,
  reason TEXT NULL,
  last_error TEXT NULL,
  sending_at DATETIME(6) NULL,
  last_attempt_at DATETIME(6) NULL,
  sent_at DATETIME(6) NULL,
  skipped_at DATETIME(6) NULL,
  failed_at DATETIME(6) NULL,
  source_created_at DATETIME(6) NULL,
  source_updated_at DATETIME(6) NULL,
  source_path VARCHAR(1024) NULL,
  source_path_sha256 BINARY(32) NULL,
  migration_run_id BIGINT UNSIGNED NULL,
  archived_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_deliveries_legacy_id (legacy_id),
  UNIQUE KEY uq_mail_deliveries_source (migration_run_id, source_path_sha256),
  KEY ix_mail_deliveries_batch (mail_batch_id, source_created_at),
  KEY ix_mail_deliveries_reviewer (reviewer_id, source_created_at DESC),
  KEY ix_mail_deliveries_status (status, source_created_at DESC, archived_at),
  CONSTRAINT chk_mail_deliveries_status CHECK (
    status IN ('pending', 'sending', 'sent', 'failed', 'skipped')
  ),
  CONSTRAINT chk_mail_deliveries_email_match CHECK (
    email_match_source IS NULL OR email_match_source IN ('id', 'name', 'none')
  ),
  CONSTRAINT fk_mail_deliveries_batch
    FOREIGN KEY (mail_batch_id) REFERENCES mail_batches (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_mail_deliveries_reviewer
    FOREIGN KEY (reviewer_id) REFERENCES reviewers (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_mail_deliveries_migration_run
    FOREIGN KEY (migration_run_id) REFERENCES migration_runs (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Firestore only retained a protocol count for historical deliveries. This
-- table starts empty for those rows and records exact delivery contents going
-- forward without inventing historical relationships.
CREATE TABLE mail_delivery_protocols (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mail_delivery_id BIGINT UNSIGNED NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  protocol_id BIGINT UNSIGNED NULL,
  rec_code_snapshot VARCHAR(100) NOT NULL,
  title_snapshot TEXT NOT NULL,
  form_type_snapshot VARCHAR(64) NULL,
  due_date_snapshot DATE NULL,
  document_link_snapshot TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_delivery_protocols_order (
    mail_delivery_id,
    display_order
  ),
  KEY ix_mail_delivery_protocols_protocol (protocol_id),
  CONSTRAINT fk_mail_delivery_protocols_delivery
    FOREIGN KEY (mail_delivery_id) REFERENCES mail_deliveries (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_mail_delivery_protocols_protocol
    FOREIGN KEY (protocol_id) REFERENCES protocols (id)
    ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE mail_delivery_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mail_delivery_id BIGINT UNSIGNED NOT NULL,
  attempt_number INT UNSIGNED NOT NULL,
  status VARCHAR(24) NOT NULL,
  external_message_id VARCHAR(998) NULL,
  error_message TEXT NULL,
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_delivery_attempts_number (
    mail_delivery_id,
    attempt_number
  ),
  KEY ix_mail_delivery_attempts_status (status, started_at DESC),
  CONSTRAINT chk_mail_delivery_attempts_status CHECK (
    status IN ('pending', 'sending', 'sent', 'failed')
  ),
  CONSTRAINT fk_mail_delivery_attempts_delivery
    FOREIGN KEY (mail_delivery_id) REFERENCES mail_deliveries (id)
    ON DELETE RESTRICT
) ENGINE = InnoDB;

INSERT INTO review_form_types (
  code,
  display_name,
  form_url,
  sort_order
) VALUES
  ('PRA1', 'Protocol Review Assessment Form', 'https://forms.office.com/r/4WuaHiiJar', 10),
  ('PRA2', 'Protocol Review Assessment Form', 'https://forms.office.com/r/4WuaHiiJar', 20),
  ('ICA', 'Informed Consent Assessment Form', 'https://forms.office.com/r/0nQCTjvBsv', 30),
  ('IACUC', 'Protocol Review Assessment for Experimental Form', 'https://forms.office.com/r/vT231a87fj', 40),
  ('IACUC2', 'Protocol Review Assessment for Experimental Form', 'https://forms.office.com/r/vT231a87fj', 50),
  ('CREF1', 'Checklist for Exemption from Review Form', 'https://forms.office.com/r/n6RU8EuT3P', 60),
  ('CREF2', 'Checklist for Exemption from Review Form', 'https://forms.office.com/r/n6RU8EuT3P', 70);

INSERT INTO notification_settings (
  singleton_id,
  enabled,
  frequency,
  send_to_reviewers,
  due_soon_threshold
) VALUES (1, FALSE, 'daily', TRUE, 3);

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'Initial normalized Firestore-to-MySQL schema');
