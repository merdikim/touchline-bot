import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  platformGroupId: text("platform_group_id").notNull().unique(),
  title: text("title"),
  latestBotPrompt: text("latest_bot_prompt"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  platformUserId: text("platform_user_id").notNull().unique(),
  username: text("username"),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(),
  txlineFixtureId: integer("txline_fixture_id").notNull().unique(),
  competitionId: integer("competition_id"),
  competition: text("competition"),
  participant1: text("participant1").notNull(),
  participant2: text("participant2").notNull(),
  participant1IsHome: integer("participant1_is_home").notNull(),
  startTime: text("start_time").notNull(),
  status: text("status"),
  rawFixture: text("raw_fixture"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const groupMatches = sqliteTable("group_matches", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  matchId: text("match_id").notNull().references(() => matches.id),
  status: text("status").notNull().default("active"),
  predictionsOpen: integer("predictions_open").notNull().default(1),
  baselineOddsSummary: text("baseline_odds_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const predictions = sqliteTable(
  "predictions",
  {
    id: text("id").primaryKey(),
    groupMatchId: text("group_match_id").notNull().references(() => groupMatches.id),
    userId: text("user_id").notNull().references(() => users.id),
    participant1Score: integer("participant1_score").notNull(),
    participant2Score: integer("participant2_score").notNull(),
    predictedWinner: text("predicted_winner"),
    points: integer("points").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => ({
    userPerMatch: uniqueIndex("predictions_group_match_user_idx").on(table.groupMatchId, table.userId)
  })
);

export const matchStates = sqliteTable("match_states", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull().unique().references(() => matches.id),
  gameState: text("game_state"),
  displayState: text("display_state"),
  participant1Score: integer("participant1_score").notNull().default(0),
  participant2Score: integer("participant2_score").notNull().default(0),
  latestSeq: integer("latest_seq"),
  latestTxlineTs: integer("latest_txline_ts"),
  confirmed: integer("confirmed").default(0),
  rawScoreSnapshot: text("raw_score_snapshot"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const oddsSnapshots = sqliteTable("odds_snapshots", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull().references(() => matches.id),
  txlineTs: integer("txline_ts"),
  summary: text("summary"),
  rawOddsSnapshot: text("raw_odds_snapshot"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const matchEvents = sqliteTable("match_events", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull().references(() => matches.id),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  txlineReference: text("txline_reference"),
  verified: integer("verified").default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const botMessages = sqliteTable("bot_messages", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  telegramMessageId: text("telegram_message_id"),
  messageType: text("message_type"),
  payload: text("payload"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});
