export type AppEnv = {
  Bindings: {
    DB: D1Database;
    MATCH_POLL_QUEUE: Queue<MatchPollJob>;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_BOT_USERNAME: string;
    AI_API_KEY: string;
    TXLINE_BASE_URL: string;
    TXLINE_JWT: string;
    TXLINE_API_TOKEN: string;
  };
};

export type WorkerEnv = AppEnv["Bindings"];

export type PollMatchJob = {
  kind?: "poll_match";
  matchId: string;
  txlineFixtureId: number;
};

export type NoPerfectPickFollowUpJob = {
  kind: "no_perfect_pick_follow_up";
  groupId: string;
};

export type MatchPollJob = PollMatchJob | NoPerfectPickFollowUpJob;
