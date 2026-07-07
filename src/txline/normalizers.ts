import type { NormalizedFixture, NormalizedScoreState, OddsSummary } from "./types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function pickString(obj: JsonObject, keys: string[], fallback?: string): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return fallback;
}

function pickNumber(obj: JsonObject, keys: string[], fallback?: number): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return fallback;
}

function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  const obj = asObject(raw);
  for (const key of ["fixtures", "data", "items", "results"]) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

export function normalizeFixtures(raw: unknown): NormalizedFixture[] {
  return unwrapList(raw).map((item) => {
    const obj = asObject(item);
    const home = asObject(obj.home ?? obj.homeTeam ?? obj.participant1);
    const away = asObject(obj.away ?? obj.awayTeam ?? obj.participant2);
    const participant1 = pickString(obj, ["participant1", "homeName", "home_team"], pickString(home, ["name", "displayName"], "Participant 1")) ?? "Participant 1";
    const participant2 = pickString(obj, ["participant2", "awayName", "away_team"], pickString(away, ["name", "displayName"], "Participant 2")) ?? "Participant 2";

    return {
      fixtureId: pickNumber(obj, ["fixtureId", "fixture_id", "id"], 0) ?? 0,
      competitionId: pickNumber(obj, ["competitionId", "competition_id"]),
      competition: pickString(obj, ["competition", "league", "competitionName"]),
      participant1,
      participant2,
      participant1IsHome: obj.participant1IsHome !== false,
      startTime: pickString(obj, ["startTime", "start_time", "kickoff", "scheduledAt"], new Date().toISOString()) ?? new Date().toISOString(),
      raw: item
    };
  }).filter((fixture) => fixture.fixtureId > 0);
}

export function normalizeScoreState(fixtureId: number, raw: unknown): NormalizedScoreState {
  const obj = asObject(raw);
  const score = asObject(obj.score ?? obj.currentScore);

  return {
    fixtureId: pickNumber(obj, ["fixtureId", "fixture_id", "id"], fixtureId) ?? fixtureId,
    gameState: pickString(obj, ["gameState", "game_state", "status"]),
    displayState: pickString(obj, ["displayState", "display_state", "clock"]),
    participant1Score: pickNumber(obj, ["participant1Score", "homeScore", "participant1_score"], pickNumber(score, ["participant1", "home"], 0)) ?? 0,
    participant2Score: pickNumber(obj, ["participant2Score", "awayScore", "participant2_score"], pickNumber(score, ["participant2", "away"], 0)) ?? 0,
    confirmed: Boolean(obj.confirmed ?? obj.verified),
    seq: pickNumber(obj, ["seq", "sequence"]),
    timestamp: pickNumber(obj, ["timestamp", "ts", "txlineTs"]),
    raw
  };
}

export function normalizeOddsSummary(raw: unknown, participant1: string, participant2: string): OddsSummary {
  const obj = asObject(raw);
  const favorite = pickString(obj, ["favorite", "favoredParticipant", "marketFavorite"]);
  const underdog = pickString(obj, ["underdog", "marketUnderdog"]);
  const movement = pickString(obj, ["movement", "marketMovement"], "unknown") ?? "unknown";
  const confidence = pickString(obj, ["confidence"], "low") ?? "low";

  return {
    favorite: favorite || undefined,
    underdog: underdog || (favorite === participant1 ? participant2 : favorite === participant2 ? participant1 : undefined),
    movement: movement === "toward_participant1" || movement === "toward_participant2" || movement === "stable" ? movement : "unknown",
    confidence: confidence === "medium" || confidence === "high" ? confidence : "low",
    raw
  };
}
