-- Founder Cockpit — initial schema.
-- Conventions (see CLAUDE.md): ULID text ids; money as INTEGER paise; dates as
-- 'YYYY-MM-DD' (IST); months as 'YYYY-MM'; timestamps ISO-8601 UTC; soft deletes
-- via deleted_at. Enum values mirror packages/core/src/schemas.ts.

CREATE TABLE people (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  role        TEXT NOT NULL CHECK (role IN ('founder', 'employee', 'contractor')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX people_email_live_uq ON people (email) WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE TABLE projects (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  client               TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('service', 'product', 'retainer')),
  owner_person_id      TEXT REFERENCES people (id),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  rag_override         TEXT CHECK (rag_override IN ('red', 'amber', 'green')),
  rag_override_reason  TEXT,
  contract_value_paise INTEGER CHECK (contract_value_paise >= 0),
  start_date           TEXT,
  end_date             TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT,
  CHECK (rag_override IS NULL OR (rag_override_reason IS NOT NULL AND length(trim(rag_override_reason)) > 0)),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX projects_owner_idx ON projects (owner_person_id);
CREATE INDEX projects_status_idx ON projects (status);
CREATE UNIQUE INDEX projects_name_live_uq ON projects (name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE milestones (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id),
  title         TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  done_at       TEXT,
  billing_paise INTEGER CHECK (billing_paise >= 0),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX milestones_project_idx ON milestones (project_id);
CREATE INDEX milestones_due_idx ON milestones (due_date);

CREATE TABLE allocations (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people (id),
  project_id  TEXT NOT NULL REFERENCES projects (id),
  month       TEXT NOT NULL,
  percent     INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX allocations_person_idx ON allocations (person_id);
CREATE INDEX allocations_project_idx ON allocations (project_id);
CREATE INDEX allocations_month_idx ON allocations (month);
CREATE UNIQUE INDEX allocations_live_uq ON allocations (person_id, project_id, month) WHERE deleted_at IS NULL;

CREATE TABLE invoices (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects (id),
  invoice_no            TEXT NOT NULL UNIQUE,
  invoice_date          TEXT NOT NULL,
  due_date              TEXT NOT NULL,
  amount_excl_gst_paise INTEGER NOT NULL CHECK (amount_excl_gst_paise >= 0),
  gst_paise             INTEGER NOT NULL CHECK (gst_paise >= 0),
  total_paise           INTEGER NOT NULL,
  notes                 TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,
  CHECK (total_paise = amount_excl_gst_paise + gst_paise),
  CHECK (due_date >= invoice_date)
);
CREATE INDEX invoices_project_idx ON invoices (project_id);
CREATE INDEX invoices_date_idx ON invoices (invoice_date);
CREATE INDEX invoices_due_idx ON invoices (due_date);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices (id),
  received_date TEXT NOT NULL,
  amount_paise  INTEGER NOT NULL CHECK (amount_paise > 0),
  mode          TEXT NOT NULL CHECK (mode IN ('bank_transfer', 'upi', 'cheque', 'cash', 'other')),
  reference     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_received_idx ON payments (received_date);

CREATE TABLE expenses (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('salary', 'founder_salary', 'tools', 'infra', 'rent', 'travel', 'other')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  vendor       TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX expenses_date_idx ON expenses (date);
CREATE INDEX expenses_category_idx ON expenses (category);

CREATE TABLE cash_snapshots (
  id            TEXT PRIMARY KEY,
  as_of_date    TEXT NOT NULL,
  balance_paise INTEGER NOT NULL,
  source        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX cash_snapshots_date_idx ON cash_snapshots (as_of_date);

CREATE TABLE pipeline_deals (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  client          TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  value_paise     INTEGER NOT NULL CHECK (value_paise >= 0),
  expected_close  TEXT,
  owner_person_id TEXT REFERENCES people (id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX pipeline_owner_idx ON pipeline_deals (owner_person_id);
CREATE INDEX pipeline_stage_idx ON pipeline_deals (stage);
CREATE INDEX pipeline_close_idx ON pipeline_deals (expected_close);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  at          TEXT NOT NULL,
  tool        TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  source_text TEXT,
  undone_at   TEXT
);
CREATE INDEX audit_at_idx ON audit_log (at);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_actor_idx ON audit_log (actor_email, at);

CREATE TABLE confirm_tokens (
  token        TEXT PRIMARY KEY,
  actor_email  TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);
CREATE INDEX confirm_tokens_expiry_idx ON confirm_tokens (expires_at);
