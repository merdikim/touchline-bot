export type BotIntent =
  | { intent: "create_group_match"; confidence: number; params: { matchQuery: string } }
  | { intent: "submit_prediction"; confidence: number; params: { rawPrediction: string; predictedWinner?: string; participant1Score?: number; participant2Score?: number } }
  | { intent: "get_match_status"; confidence: number; params: Record<string, never> }
  | { intent: "get_leaderboard"; confidence: number; params: Record<string, never> }
  | { intent: "get_odds_commentary"; confidence: number; params: Record<string, never> }
  | { intent: "get_verification"; confidence: number; params: Record<string, never> }
  | { intent: "get_available_matches"; confidence: number; params: { date?: string; teamQuery?: string } }
  | { intent: "run_demo"; confidence: number; params: Record<string, never> }
  | { intent: "smalltalk"; confidence: number; params: Record<string, never> }
  | { intent: "unclear"; confidence: number; params: { clarificationQuestion: string } };

const emptyParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {}
} as const;

export const intentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence", "params"],
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
    params: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["matchQuery"],
          properties: { matchQuery: { type: "string" } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["rawPrediction"],
          properties: {
            rawPrediction: { type: "string" },
            predictedWinner: { type: "string", enum: ["participant1", "participant2", "draw"] },
            participant1Score: { type: "number" },
            participant2Score: { type: "number" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string" },
            teamQuery: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["clarificationQuestion"],
          properties: { clarificationQuestion: { type: "string" } }
        },
        emptyParamsSchema
      ]
    }
  }
} as const;
