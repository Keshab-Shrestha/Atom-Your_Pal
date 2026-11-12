CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      owner TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'personal',
      source TEXT NOT NULL,
      request_id TEXT,
      created_at TEXT NOT NULL
    , expires_at TEXT, superseded_by INTEGER);
CREATE INDEX memories_owner ON memories(owner, id);
CREATE VIRTUAL TABLE memories_fts USING fts5(text, content='memories', content_rowid='id')
/* memories_fts(text) */;
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
    END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      exchanges INTEGER NOT NULL,
      ended_at TEXT NOT NULL,
      UNIQUE (owner, session_id)
    );
CREATE TABLE memory_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      memory_id INTEGER NOT NULL,
      replaced_by INTEGER NOT NULL,
      created_new INTEGER NOT NULL DEFAULT 0,
      undone_at TEXT
    );
CREATE TABLE file_permissions (
    chat_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (chat_id, path)
  );
CREATE TABLE foreground_attempts (
    id TEXT PRIMARY KEY COLLATE NOCASE, chat TEXT NOT NULL, signature TEXT NOT NULL,
    text TEXT NOT NULL, files TEXT NOT NULL, notes TEXT NOT NULL, source TEXT NOT NULL,
    provider TEXT, model TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    reply TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, archive_seq INTEGER, reply_hash TEXT, dismissed INTEGER NOT NULL DEFAULT 0
  );
CREATE TABLE foreground_answers (
    attempt_id TEXT NOT NULL COLLATE NOCASE, id TEXT PRIMARY KEY COLLATE NOCASE, question TEXT NOT NULL, answer TEXT NOT NULL, answer_hash TEXT NOT NULL
  );
CREATE INDEX foreground_chat ON foreground_attempts(chat, dismissed);
CREATE INDEX foreground_answer_attempt ON foreground_answers(attempt_id);
CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , provider TEXT, model TEXT, session TEXT, project_id TEXT, named INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, flags_version INTEGER NOT NULL DEFAULT 0, brief TEXT NOT NULL DEFAULT '', brief_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE chat_messages (
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      PRIMARY KEY (chat_id, seq)
    );
CREATE INDEX chats_updated ON chats(updated_at);
CREATE TABLE chat_access (
      chat_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('checked', 'chat-only', 'ask-changes', 'full'))
    );
CREATE TRIGGER chat_access_deleted AFTER DELETE ON chats BEGIN
      DELETE FROM chat_access WHERE chat_id = old.id;
    END;
CREATE TABLE chat_reasoning (
      chat_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL,
      PRIMARY KEY (chat_id, provider, model)
    );
CREATE TRIGGER chat_reasoning_deleted AFTER DELETE ON chats BEGIN
      DELETE FROM chat_reasoning WHERE chat_id = old.id;
    END;
CREATE TABLE pending_chat_models (
      chat_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL
    );
CREATE INDEX chats_project ON chats(project_id, updated_at);
CREATE TABLE chat_navigation (slot TEXT PRIMARY KEY CHECK (slot = 'window'), chat_id TEXT NOT NULL);
CREATE TABLE chat_branches (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, message_count INTEGER NOT NULL, kind TEXT NOT NULL, revision TEXT NOT NULL);
CREATE VIRTUAL TABLE chat_fts USING fts5(text, chat_id UNINDEXED)
/* chat_fts(text,chat_id) */;
CREATE TRIGGER chat_fts_insert AFTER INSERT ON chat_messages BEGIN
      INSERT INTO chat_fts (rowid, text, chat_id) VALUES (new.rowid, new.content, new.chat_id);
    END;
CREATE TRIGGER chat_fts_delete AFTER DELETE ON chat_messages BEGIN
      DELETE FROM chat_fts WHERE rowid = old.rowid;
    END;
CREATE TABLE chat_continuity (
    chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 0, summary TEXT
  );
CREATE TRIGGER chat_continuity_deleted AFTER DELETE ON chats BEGIN
    DELETE FROM chat_continuity WHERE chat_id = old.id;
  END;
CREATE TABLE chat_recall_receipts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, chat TEXT NOT NULL, request TEXT NOT NULL,
    attempt TEXT NOT NULL, at TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(owner, attempt));
CREATE INDEX chat_recall_recent ON chat_recall_receipts(owner, chat, seq DESC);
CREATE TRIGGER chat_recall_deleted AFTER DELETE ON chats BEGIN DELETE FROM chat_recall_receipts WHERE chat = old.id; END;
CREATE TABLE kept_chats (
      chat_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      messages INTEGER NOT NULL,
      kept_at TEXT NOT NULL,
      vec BLOB
    );
CREATE TABLE kept_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      heading TEXT NOT NULL,
      body TEXT NOT NULL,
      vec BLOB
    );
CREATE INDEX kept_sections_chat ON kept_sections(chat_id);
CREATE TABLE kept_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      text TEXT NOT NULL,
      vec BLOB
    );
CREATE INDEX kept_lines_section ON kept_lines(section_id);
CREATE VIRTUAL TABLE kept_fts USING fts5(text, level UNINDEXED, ref UNINDEXED)
/* kept_fts(text,level,ref) */;
CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folders TEXT NOT NULL,
      helper TEXT,
      provider TEXT,
      model TEXT,
      kit TEXT NOT NULL DEFAULT 'folders',
      web INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE TABLE brain_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL COLLATE NOCASE UNIQUE,
      body TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'note',
      ref TEXT,
      ghost INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE UNIQUE INDEX brain_notes_ref ON brain_notes(ref) WHERE ref IS NOT NULL;
CREATE TABLE brain_links (
      src INTEGER NOT NULL,
      dst INTEGER NOT NULL,
      auto INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (src, dst, auto)
    );
CREATE INDEX brain_links_dst ON brain_links(dst);
CREATE TABLE brain_tags (
      note INTEGER NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (note, tag)
    );
CREATE INDEX brain_tags_tag ON brain_tags(tag);
CREATE VIRTUAL TABLE brain_fts USING fts5(title, body, content='brain_notes', content_rowid='id')
/* brain_fts(title,body) */;
CREATE TRIGGER brain_ai AFTER INSERT ON brain_notes BEGIN
      INSERT INTO brain_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
CREATE TRIGGER brain_ad AFTER DELETE ON brain_notes BEGIN
      INSERT INTO brain_fts(brain_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END;
CREATE TRIGGER brain_au AFTER UPDATE ON brain_notes BEGIN
      INSERT INTO brain_fts(brain_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO brain_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
CREATE TABLE brain_source_folder (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1), id TEXT NOT NULL, path TEXT NOT NULL,
      identity TEXT NOT NULL, checked_at TEXT NOT NULL, skipped INTEGER NOT NULL DEFAULT 0
    );
CREATE TABLE brain_source_files (
      path TEXT PRIMARY KEY, note_id INTEGER, source_hash TEXT NOT NULL, note_hash TEXT NOT NULL,
      observed_hash TEXT, excluded INTEGER NOT NULL DEFAULT 0
    );
CREATE INDEX brain_source_note ON brain_source_files(note_id);
CREATE TABLE brain_source_formats (source_id TEXT PRIMARY KEY, documents INTEGER NOT NULL DEFAULT 0 CHECK(documents IN (0, 1)));
CREATE TABLE source_analysis_state (slot INTEGER PRIMARY KEY CHECK(slot = 1), source_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE source_analysis_parts (seq INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, note_id INTEGER NOT NULL, hash TEXT NOT NULL, offset INTEGER NOT NULL, profile TEXT NOT NULL, data TEXT NOT NULL,
      UNIQUE(source_id, note_id, hash, offset, profile));
CREATE TABLE source_analysis_usage (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
CREATE TRIGGER source_analysis_removed AFTER DELETE ON brain_source_folder BEGIN
      DELETE FROM source_analysis_parts WHERE source_id = old.id;
      DELETE FROM source_analysis_state WHERE source_id = old.id;
    END;
CREATE TRIGGER source_analysis_note_deleted AFTER DELETE ON brain_notes BEGIN DELETE FROM source_analysis_parts WHERE note_id = old.id; END;
CREATE TRIGGER source_analysis_note_edited AFTER UPDATE OF title, body, ghost ON brain_notes BEGIN DELETE FROM source_analysis_parts WHERE note_id = old.id; END;
CREATE TRIGGER source_analysis_note_excluded AFTER UPDATE OF excluded ON brain_source_files WHEN new.excluded = 1 BEGIN DELETE FROM source_analysis_parts WHERE note_id = old.note_id; END;
CREATE TABLE briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      lines TEXT NOT NULL,
      source TEXT NOT NULL
    , preparation TEXT);
CREATE TABLE brief_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE brief_preparation_usage (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
