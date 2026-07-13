import type { NormalizedFixture, NormalizedScoreState, OddsSummary } from "./types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function getValue(obj: JsonObject, key: string) {
  if (key in obj) {
    return obj[key];
  }
  const normalizedKey = key.toLowerCase().replaceAll("_", "");
  const match = Object.keys(obj).find((candidate) => candidate.toLowerCase().replaceAll("_", "") === normalizedKey);
  return match ? obj[match] : undefined;
}

function pickString(obj: JsonObject, keys: string[], fallback?: string): string | undefined {
  for (const key of keys) {
    const value = getValue(obj, key);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return fallback;
}

function pickNumber(obj: JsonObject, keys: string[], fallback?: number): number | undefined {
  for (const key of keys) {
    const value = getValue(obj, key);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return fallback;
}

function pickBoolean(obj: JsonObject, keys: string[], fallback?: boolean): boolean | undefined {
  for (const key of keys) {
    const value = getValue(obj, key);
    if (typeof value === "boolean") {
      return value;
    }
  }
  return fallback;
}

function nestedNumber(value: unknown, path: string[]): number | undefined {
  let current = value;
  for (const key of path) {
    const obj = asObject(current);
    current = getValue(obj, key);
  }
  if (typeof current === "number" && Number.isFinite(current)) {
    return current;
  }
  if (typeof current === "string" && current.trim() && Number.isFinite(Number(current))) {
    return Number(current);
  }
  return undefined;
}

function pickDateString(obj: JsonObject, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = getValue(obj, key);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
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

function unwrapObject(raw: unknown): JsonObject {
  if (Array.isArray(raw)) {
    return selectScoreEvent(raw.map(asObject));
  }

  const obj = asObject(raw);
  for (const key of ["data", "item", "result", "snapshot"]) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return selectScoreEvent(value.map(asObject));
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JsonObject;
    }
  }
  return obj;
}

function selectScoreEvent(events: JsonObject[]): JsonObject {
  const final = events
    .filter((event) => isFinalEvent(event))
    .sort((a, b) => eventSortValue(b) - eventSortValue(a))[0];
  if (final) {
    return final;
  }

  const withScore = events
    .filter((event) => Object.keys(asObject(getValue(event, "score") ?? getValue(event, "Score") ?? getValue(event, "currentScore"))).length > 0)
    .sort((a, b) => eventSortValue(b) - eventSortValue(a))[0];
  if (withScore) {
    return withScore;
  }

  return events.sort((a, b) => eventSortValue(b) - eventSortValue(a))[0] ?? {};
}

function eventSortValue(event: JsonObject) {
  return pickNumber(event, ["seq", "Seq", "timestamp", "Ts", "id", "Id"], 0) ?? 0;
}

function isFinalEvent(event: JsonObject) {
  const action = pickString(event, ["action", "Action"], "")?.toLowerCase() ?? "";
  const statusId = pickNumber(event, ["statusId", "StatusId"]);
  return statusId === 100 || /\b(game_)?finali[sz]ed|full[_ -]?time|ended|complete|completed\b/.test(action);
}

function statusDisplay(obj: JsonObject) {
  const statusId = pickNumber(obj, ["statusId", "StatusId"]);
  if (statusId === 100 || isFinalEvent(obj)) {
    return "Full-time";
  }
  if (statusId === 5) {
    return "Full-time";
  }
  if (statusId === 4) {
    return "2H";
  }
  if (statusId === 3) {
    return "Half-time";
  }
  if (statusId === 2) {
    return "1H";
  }
  return undefined;
}

function scoreGoals(obj: JsonObject, participant: "Participant1" | "Participant2") {
  const score = asObject(getValue(obj, "score") ?? getValue(obj, "Score") ?? getValue(obj, "currentScore"));
  const participantScore = getValue(score, participant) ?? getValue(score, participant.toLowerCase());
  return nestedNumber(participantScore, ["Total", "Goals"])
    ?? nestedNumber(participantScore, ["total", "goals"])
    ?? nestedNumber(participantScore, ["Goals"])
    ?? nestedNumber(participantScore, ["goals"]);
}

export function normalizeFixtures(raw: unknown): NormalizedFixture[] {
  return unwrapList(raw).map((item) => {
    const obj = asObject(item);
    const home = asObject(obj.home ?? obj.homeTeam ?? obj.participant1);
    const away = asObject(obj.away ?? obj.awayTeam ?? obj.participant2);
    const participant1 = pickString(obj, ["Participant1", "participant1", "homeName", "home_team"], pickString(home, ["name", "displayName"], "Participant 1")) ?? "Participant 1";
    const participant2 = pickString(obj, ["Participant2", "participant2", "awayName", "away_team"], pickString(away, ["name", "displayName"], "Participant 2")) ?? "Participant 2";

    return {
      fixtureId: pickNumber(obj, ["FixtureId", "fixtureId", "fixture_id", "id"], 0) ?? 0,
      competitionId: pickNumber(obj, ["CompetitionId", "competitionId", "competition_id"]),
      competition: pickString(obj, ["Competition", "competition", "league", "competitionName"]),
      participant1,
      participant2,
      participant1IsHome: pickBoolean(obj, ["Participant1IsHome", "participant1IsHome"], true) ?? true,
      startTime: pickDateString(obj, ["StartTime", "startTime", "start_time", "kickoff", "scheduledAt"], new Date().toISOString()),
      raw: item
    };
  }).filter((fixture) => fixture.fixtureId > 0);
}

export function normalizeScoreState(fixtureId: number, raw: unknown): NormalizedScoreState {
  const obj = unwrapObject(raw);
  const score = asObject(getValue(obj, "score") ?? getValue(obj, "Score") ?? getValue(obj, "currentScore"));
  const stats = asObject(getValue(obj, "stats") ?? getValue(obj, "Stats"));
  const displayState = pickString(obj, ["displayState", "display_state", "clock", "period", "time", "minute"])
    ?? statusDisplay(obj);
  const final = isFinalEvent(obj);

  return {
    fixtureId: pickNumber(obj, ["FixtureId", "fixtureId", "fixture_id", "id"], fixtureId) ?? fixtureId,
    gameState: final
      ? "final"
      : pickString(obj, ["gameState", "game_state", "status", "matchStatus", "fixtureStatus", "state"]),
    displayState,
    participant1Score: pickNumber(obj, ["participant1Score", "homeScore", "participant1_score", "score1", "home_score"], scoreGoals(obj, "Participant1") ?? pickNumber(score, ["participant1", "home", "participant1Score", "homeScore"], pickNumber(stats, ["1"], 0))) ?? 0,
    participant2Score: pickNumber(obj, ["participant2Score", "awayScore", "participant2_score", "score2", "away_score"], scoreGoals(obj, "Participant2") ?? pickNumber(score, ["participant2", "away", "participant2Score", "awayScore"], pickNumber(stats, ["2"], 0))) ?? 0,
    confirmed: Boolean(getValue(obj, "confirmed") ?? getValue(obj, "Confirmed") ?? getValue(obj, "verified")),
    seq: pickNumber(obj, ["seq", "Seq", "sequence"]),
    timestamp: pickNumber(obj, ["timestamp", "ts", "txlineTs", "Ts"]),
    raw
  };
}

export function normalizeOddsSummary(raw: unknown, participant1: string, participant2: string): OddsSummary {
  const obj = unwrapObject(raw);
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
