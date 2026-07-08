export type BotIntentName =
  | "create_group_match"
  | "submit_prediction"
  | "get_match_status"
  | "get_leaderboard"
  | "get_odds_commentary"
  | "get_verification"
  | "get_available_matches"
  | "run_demo"
  | "smalltalk"
  | "unclear";

export type MatchRef = {
  team1: string | null;
  team2: string | null;
};

export type PredictionRef = {
  raw: string;
  team1Score: number | null;
  team2Score: number | null;
  winner: "team1" | "team2" | "draw" | null;
};

export type BotIntent = {
  intent: BotIntentName;
  confidence: number;
  match: MatchRef;
  prediction: PredictionRef | null;
  teamQuery: string | null;
  dateQuery: string | null;
  clarificationQuestion: string | null;
};

const matchRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["team1", "team2"],
  properties: {
    team1: { type: ["string", "null"] },
    team2: { type: ["string", "null"] }
  }
} as const;

export const intentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence", "match", "prediction", "teamQuery", "dateQuery", "clarificationQuestion"],
  properties: {
    intent: {
      type: "string",
      enum: [
        "create_group_match",
        "submit_prediction",
        "get_match_status",
        "get_leaderboard",
        "get_odds_commentary",
        "get_verification",
        "get_available_matches",
        "run_demo",
        "smalltalk",
        "unclear"
      ]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    match: matchRefSchema,
    prediction: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["raw", "team1Score", "team2Score", "winner"],
      properties: {
        raw: { type: "string" },
        team1Score: { type: ["number", "null"] },
        team2Score: { type: ["number", "null"] },
        winner: { type: ["string", "null"], enum: ["team1", "team2", "draw", null] }
      }
    },
    teamQuery: { type: ["string", "null"] },
    dateQuery: { type: ["string", "null"] },
    clarificationQuestion: { type: ["string", "null"] }
  }
} as const;
