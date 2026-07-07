CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_group_id TEXT NOT NULL UNIQUE,
  title TEXT,
  latest_bot_prompt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  txline_fixture_id INTEGER NOT NULL UNIQUE,
  competition_id INTEGER,
  competition TEXT,
  participant1 TEXT NOT NULL,
  participant2 TEXT NOT NULL,
  participant1_is_home INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  status TEXT,
  raw_fixture TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_matches (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  predictions_open INTEGER NOT NULL DEFAULT 1,
  baseline_odds_summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE predictions (
  id TEXT PRIMARY KEY,
  group_match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  participant1_score INTEGER NOT NULL,
  participant2_score INTEGER NOT NULL,
  predicted_winner TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_match_id, user_id),
  FOREIGN KEY (group_match_id) REFERENCES group_matches(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE match_states (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  game_state TEXT,
  display_state TEXT,
  participant1_score INTEGER NOT NULL DEFAULT 0,
  participant2_score INTEGER NOT NULL DEFAULT 0,
  latest_seq INTEGER,
  latest_txline_ts INTEGER,
  confirmed INTEGER DEFAULT 0,
  raw_score_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE odds_snapshots (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  txline_ts INTEGER,
  summary TEXT,
  raw_odds_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE match_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  txline_reference TEXT,
  verified INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE bot_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  telegram_message_id TEXT,
  message_type TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE INDEX idx_group_matches_group_status ON group_matches(group_id, status);
CREATE INDEX idx_predictions_group_match ON predictions(group_match_id);
CREATE INDEX idx_match_events_match ON match_events(match_id);
