CREATE TABLE match_reminders (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT,
  requester_username TEXT,
  requester_display_name TEXT,
  txline_fixture_id INTEGER NOT NULL,
  participant1 TEXT NOT NULL,
  participant2 TEXT NOT NULL,
  competition TEXT,
  start_time TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_match_reminders_due ON match_reminders(status, remind_at);
CREATE INDEX idx_match_reminders_group ON match_reminders(group_id);
