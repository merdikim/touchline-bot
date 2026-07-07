export type NormalizedFixture = {
  fixtureId: number;
  competitionId?: number;
  competition?: string;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  startTime: string;
  raw: unknown;
};

export type NormalizedScoreState = {
  fixtureId: number;
  gameState?: string;
  displayState?: string;
  participant1Score: number;
  participant2Score: number;
  confirmed?: boolean;
  seq?: number;
  timestamp?: number;
  raw: unknown;
};

export type OddsSummary = {
  favorite?: string;
  underdog?: string;
  movement?: "toward_participant1" | "toward_participant2" | "stable" | "unknown";
  confidence?: "low" | "medium" | "high";
  raw: unknown;
};
