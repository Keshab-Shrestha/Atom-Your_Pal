CREATE TABLE tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    run_key TEXT NOT NULL,
    agent TEXT,
    tool TEXT NOT NULL,
    input TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started', 'ok', 'error')),
    result TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    UNIQUE (job_id, run_key)
  );
CREATE INDEX tool_calls_job ON tool_calls(job_id, id);
CREATE TABLE checkpoints (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    rel TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('modified', 'created')),
    state TEXT NOT NULL CHECK (state IN ('ready', 'undone', 'skipped')),
    reason TEXT,
    size INTEGER,
    sha_before TEXT,
    sha_after TEXT,
    snap TEXT,
    guarded INTEGER NOT NULL DEFAULT 0,
    UNIQUE (job_id, path)
  );
CREATE TABLE skill_hub_installs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('new', 'update')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    repo TEXT NOT NULL,
    path TEXT NOT NULL,
    sha TEXT NOT NULL,
    text TEXT NOT NULL,
    flags TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE skill_hub (
    name TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    path TEXT NOT NULL,
    sha TEXT NOT NULL,
    origin_url TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    previous_text TEXT,
    previous_sha TEXT
  );
CREATE TABLE helper_apps (
      helper TEXT PRIMARY KEY,
      app TEXT NOT NULL
    );
CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      helper TEXT NOT NULL,
      task TEXT NOT NULL,
      state TEXT NOT NULL,
      step TEXT,
      partial INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      ended_at TEXT
    , model TEXT, model_reason TEXT, goal TEXT, parent_id INTEGER, goal_id INTEGER, wake_pending INTEGER, seen_comments INTEGER, brief_from INTEGER, session_id TEXT, plan_first INTEGER, rating TEXT, rating_comment TEXT, reviews INTEGER, auto_retries INTEGER, plan TEXT, plan_summary TEXT, plan_status TEXT, review_kind TEXT, review_skill TEXT, interrupted INTEGER, chat_id TEXT, sdk_task_id TEXT, native_scope TEXT CHECK(native_scope IS NULL OR native_scope = 'advisory'), recovery_needed INTEGER, retry_of INTEGER, retry_next INTEGER);
CREATE INDEX jobs_helper ON jobs(helper, id);
CREATE TABLE reports (
      job_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      sources TEXT NOT NULL
    );
CREATE TABLE helper_models (
      helper TEXT PRIMARY KEY,
      model TEXT NOT NULL
    );
CREATE TABLE helper_codex_models (
      helper TEXT PRIMARY KEY,
      model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 100)
    );
CREATE TABLE helper_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
CREATE TABLE job_blockers (
      job_id INTEGER NOT NULL,
      blocker_id INTEGER NOT NULL,
      PRIMARY KEY (job_id, blocker_id)
    );
CREATE INDEX job_blockers_blocker ON job_blockers(blocker_id);
CREATE TABLE job_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    , delivery TEXT);
CREATE TABLE job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      at TEXT NOT NULL
    );
CREATE TABLE souls (
      helper TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      personality TEXT NOT NULL,
      how_it_works TEXT NOT NULL,
      rules TEXT NOT NULL,
      lessons TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (helper, version)
    );
CREATE TABLE goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ended_at TEXT,
      report TEXT,
      source TEXT
    , chat_posted_at TEXT, project_id TEXT);
CREATE TABLE helper_skills (
      helper TEXT NOT NULL,
      skill TEXT NOT NULL,
      PRIMARY KEY (helper, skill)
    );
CREATE TABLE grants (
      helper TEXT NOT NULL,
      path TEXT NOT NULL,
      PRIMARY KEY (helper, path)
    );
CREATE UNIQUE INDEX jobs_retry_of ON jobs(retry_of) WHERE retry_of IS NOT NULL;
CREATE TABLE routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    helper TEXT NOT NULL,
    task TEXT NOT NULL,
    schedule TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_at TEXT,
    last_task_id INTEGER,
    last_skipped INTEGER NOT NULL DEFAULT 0
  , paused INTEGER, resumed_at TEXT, notify_telegram INTEGER, webhook INTEGER);
CREATE TABLE proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    helper TEXT NOT NULL,
    field TEXT NOT NULL,
    text TEXT NOT NULL,
    reason TEXT NOT NULL,
    job_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    previous_version INTEGER
  );
CREATE TABLE mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    command TEXT,
    args TEXT NOT NULL,
    env TEXT NOT NULL,
    url TEXT,
    transport TEXT NOT NULL,
    headers TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    trusted INTEGER NOT NULL DEFAULT 0,
    workers TEXT NOT NULL DEFAULT '[]',
    tools TEXT NOT NULL DEFAULT '[]',
    tested_at TEXT,
    problem TEXT
  );
CREATE TABLE usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('chat', 'job')),
      helper TEXT,
      job_id INTEGER,
      model TEXT NOT NULL,
      input INTEGER NOT NULL,
      output INTEGER NOT NULL,
      cache_read INTEGER NOT NULL,
      cache_write INTEGER NOT NULL,
      dollars REAL NOT NULL DEFAULT 0
    , chat_id TEXT, gap_ms INTEGER, cache_ttl TEXT, web_searches INTEGER NOT NULL DEFAULT 0, dollars_sdk REAL);
CREATE INDEX usage_at ON usage (at);
CREATE TABLE task_attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, job_id INTEGER NOT NULL,
      state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT
    );
CREATE INDEX task_attempts_job ON task_attempts(job_id, seq);
CREATE UNIQUE INDEX task_attempts_running ON task_attempts(job_id) WHERE state = 'running';
CREATE TABLE task_inspections (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, attempt_id TEXT NOT NULL,
      receipt TEXT NOT NULL
    );
CREATE INDEX task_inspections_attempt ON task_inspections(attempt_id, seq);
CREATE TABLE task_verifications (
      id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, receipt TEXT NOT NULL
    );
CREATE TRIGGER task_evidence_deleted AFTER DELETE ON jobs BEGIN
      DELETE FROM task_inspections WHERE attempt_id IN (SELECT id FROM task_attempts WHERE job_id = old.id);
      DELETE FROM task_attempts WHERE job_id = old.id;
    END;
CREATE TRIGGER task_verification_deleted AFTER DELETE ON task_attempts BEGIN
    DELETE FROM task_verifications WHERE attempt_id = old.id;
  END;
CREATE TABLE work_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      portions TEXT NOT NULL,
      created_at TEXT NOT NULL
    , dismissed_at TEXT);
CREATE INDEX work_plans_chat ON work_plans (chat_id, id);
CREATE TABLE plan_jobs (
      plan_id INTEGER NOT NULL,
      n INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      PRIMARY KEY (plan_id, n)
    );
CREATE INDEX plan_jobs_job ON plan_jobs (job_id);
CREATE TABLE job_labels (
      job_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY (job_id, label)
    );
CREATE INDEX job_labels_label ON job_labels(label);
CREATE TRIGGER job_labels_gone AFTER DELETE ON jobs BEGIN
      DELETE FROM job_labels WHERE job_id = old.id;
    END;
CREATE VIRTUAL TABLE task_fts USING fts5(text)
/* task_fts(text) */;
CREATE TRIGGER task_fts_insert AFTER INSERT ON jobs BEGIN
      INSERT INTO task_fts (rowid, text) VALUES (new.id, new.task);
    END;
CREATE TRIGGER task_fts_update AFTER UPDATE OF task ON jobs BEGIN
      DELETE FROM task_fts WHERE rowid = old.id;
      INSERT INTO task_fts (rowid, text) VALUES (new.id, new.task);
    END;
CREATE TRIGGER task_fts_delete AFTER DELETE ON jobs BEGIN
      DELETE FROM task_fts WHERE rowid = old.id;
    END;
CREATE VIRTUAL TABLE note_fts USING fts5(text, job_id UNINDEXED)
/* note_fts(text,job_id) */;
CREATE TRIGGER note_fts_insert AFTER INSERT ON job_comments BEGIN
      INSERT INTO note_fts (rowid, text, job_id) VALUES (new.id, new.text, new.job_id);
    END;
CREATE TRIGGER note_fts_delete AFTER DELETE ON job_comments BEGIN
      DELETE FROM note_fts WHERE rowid = old.id;
    END;
CREATE VIRTUAL TABLE report_fts USING fts5(title, summary, body)
/* report_fts(title,summary,body) */;
CREATE TRIGGER report_fts_replace BEFORE INSERT ON reports BEGIN
      DELETE FROM report_fts WHERE rowid = new.job_id;
    END;
CREATE TRIGGER report_fts_insert AFTER INSERT ON reports BEGIN
      INSERT INTO report_fts (rowid, title, summary, body) VALUES (new.job_id, new.title, new.summary, new.body);
    END;
CREATE TRIGGER report_fts_delete AFTER DELETE ON reports BEGIN
      DELETE FROM report_fts WHERE rowid = old.job_id;
    END;
CREATE TABLE test_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_kind TEXT NOT NULL,
      target TEXT NOT NULL,
      job_id INTEGER NOT NULL,
      task TEXT NOT NULL,
      report TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
CREATE TABLE test_results (
      kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      case_id INTEGER NOT NULL,
      task TEXT NOT NULL,
      state TEXT NOT NULL,
      better TEXT,
      reason TEXT,
      old_answer TEXT,
      new_answer TEXT,
      at TEXT NOT NULL,
      PRIMARY KEY (kind, item_id, case_id)
    );
CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL
    );
CREATE TABLE skill_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      helper TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      body TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
CREATE TABLE skill_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill TEXT NOT NULL,
      job_id INTEGER NOT NULL,
      old_body TEXT NOT NULL,
      new_body TEXT NOT NULL,
      reason TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
CREATE TABLE skill_uses (
      job_id INTEGER NOT NULL,
      skill TEXT NOT NULL,
      PRIMARY KEY (job_id, skill)
    );
CREATE TABLE plan_repairs (
    plan_id INTEGER NOT NULL, n INTEGER NOT NULL, source_job_id INTEGER NOT NULL,
    retry_job_id INTEGER NOT NULL UNIQUE, receipt TEXT NOT NULL, PRIMARY KEY(plan_id, n)
  );
