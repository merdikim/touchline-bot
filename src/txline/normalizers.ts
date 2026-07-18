import type { NormalizedFixture, NormalizedScoreState, OddsMarket1x2, OddsSummary, ProofNode, ProvenStat, ScoreProof } from "./types";

// TxLINE soccer stat keys used for score verification.
export const STAT_KEY_PARTICIPANT1_SCORE = 1;
export const STAT_KEY_PARTICIPANT2_SCORE = 2;

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
  const market = extract1x2Market(raw);

  // the provider may also send these directly on wrapper objects; the parsed market wins when present
  const obj = Array.isArray(raw) ? {} : asObject(raw);
  const explicitFavorite = pickString(obj, ["favorite", "favoredParticipant", "marketFavorite"]);
  const movement = pickString(obj, ["movement", "marketMovement"], "unknown") ?? "unknown";
  const explicitConfidence = pickString(obj, ["confidence"]);

  const favorite = market
    ? market.prob1 >= market.prob2 ? participant1 : participant2
    : explicitFavorite || undefined;
  const underdog = favorite === participant1 ? participant2 : favorite === participant2 ? participant1 : undefined;
  const confidence = market ? confidenceFromMarket(market) : explicitConfidence;

  return {
    favorite,
    underdog,
    movement: movement === "toward_participant1" || movement === "toward_participant2" || movement === "stable" ? movement : "unknown",
    confidence: confidence === "medium" || confidence === "high" ? confidence : "low",
    market,
    raw
  };
}

function extract1x2Market(raw: unknown): OddsMarket1x2 | null {
  const market = find1x2Market(unwrapOddsMarkets(raw));
  if (!market) {
    return null;
  }

  const names = (getValue(market, "PriceNames") ?? getValue(market, "priceNames") ?? []) as unknown[];
  const lowerNames = names.map((name) => String(name).toLowerCase());
  const prices = readNumberList(getValue(market, "Prices") ?? getValue(market, "prices"));
  const pct = readNumberList(getValue(market, "Pct") ?? getValue(market, "pct") ?? getValue(market, "Percentages"));

  const i1 = indexOfName(lowerNames, ["part1", "participant1", "home", "p1", "1"], 0);
  const iX = indexOfName(lowerNames, ["draw", "x", "tie"], 1);
  const i2 = indexOfName(lowerNames, ["part2", "participant2", "away", "p2", "2"], 2);

  // implied probabilities: prefer the provider's Pct, otherwise derive from decimal prices
  let p1 = pct[i1];
  let pX = pct[iX];
  let p2 = pct[i2];
  if (![p1, pX, p2].every((value) => Number.isFinite(value)) || p1 + pX + p2 <= 0) {
    // prices are decimal odds x1000 (1617 => 1.617), so implied = 1 / decimal = 1000 / price
    p1 = prices[i1] > 0 ? 1000 / prices[i1] : NaN;
    pX = prices[iX] > 0 ? 1000 / prices[iX] : NaN;
    p2 = prices[i2] > 0 ? 1000 / prices[i2] : NaN;
  }

  const sum = p1 + pX + p2;
  if (!Number.isFinite(sum) || sum <= 0) {
    return null;
  }

  return {
    prob1: (p1 / sum) * 100,
    probDraw: (pX / sum) * 100,
    prob2: (p2 / sum) * 100,
    price1: decimalPrice(prices[i1]),
    priceDraw: decimalPrice(prices[iX]),
    price2: decimalPrice(prices[i2])
  };
}

function unwrapOddsMarkets(raw: unknown): JsonObject[] {
  if (Array.isArray(raw)) {
    return raw.map(asObject);
  }
  const obj = asObject(raw);
  for (const key of ["markets", "odds", "data", "items", "results", "snapshot"]) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value.map(asObject);
    }
  }
  // a single market object handed back on its own
  if (getValue(obj, "Prices") ?? getValue(obj, "SuperOddsType")) {
    return [obj];
  }
  return [];
}

function find1x2Market(markets: JsonObject[]): JsonObject | undefined {
  return markets.find((market) => {
    const type = (pickString(market, ["SuperOddsType", "superOddsType", "type", "marketType"], "") ?? "").toUpperCase();
    if (type.includes("1X2") || type.includes("PARTICIPANT_RESULT")) {
      return true;
    }
    const names = getValue(market, "PriceNames") ?? getValue(market, "priceNames");
    const prices = getValue(market, "Prices") ?? getValue(market, "prices");
    const hasDraw = Array.isArray(names) && names.map((name) => String(name).toLowerCase()).includes("draw");
    return hasDraw && Array.isArray(prices) && prices.length === 3;
  });
}

function readNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (typeof item === "number") {
      return item;
    }
    if (typeof item === "string" && item.trim() && Number.isFinite(Number(item))) {
      return Number(item);
    }
    return NaN;
  });
}

function indexOfName(names: string[], candidates: string[], fallback: number): number {
  for (const candidate of candidates) {
    const index = names.indexOf(candidate);
    if (index >= 0) {
      return index;
    }
  }
  return fallback;
}

function proofNodes(value: unknown): ProofNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((node) => {
    const obj = asObject(node);
    const hash = getValue(obj, "hash");
    if (!Array.isArray(hash)) {
      return [];
    }
    return [{
      hash: hash.filter((byte): byte is number => typeof byte === "number"),
      isRightSibling: pickBoolean(obj, ["isRightSibling"], false) ?? false
    }];
  });
}

function provenStat(value: unknown): ProvenStat | undefined {
  const obj = asObject(value);
  const key = pickNumber(obj, ["key"]);
  const statValue = pickNumber(obj, ["value"]);
  if (key === undefined || statValue === undefined) {
    return undefined;
  }
  return { key, value: statValue, period: pickNumber(obj, ["period"], 0) ?? 0 };
}

/**
 * Normalizes a /api/scores/stat-validation payload. Handles both legacy mode
 * (statToProve + statToProve2) and V2 mode (statsToProve), so the caller does not
 * care which shape TxLINE returned.
 */
export function normalizeScoreProof(fixtureId: number, seq: number, raw: unknown): ScoreProof {
  const obj = asObject(raw);

  const stats = [
    provenStat(getValue(obj, "statToProve")),
    provenStat(getValue(obj, "statToProve2")),
    ...(Array.isArray(getValue(obj, "statsToProve")) ? (getValue(obj, "statsToProve") as unknown[]).map(provenStat) : [])
  ].filter((stat): stat is ProvenStat => Boolean(stat));

  const scoreFor = (key: number) => stats.find((stat) => stat.key === key)?.value;

  const summary = asObject(getValue(obj, "summary"));
  const subTreeRoot = getValue(summary, "eventStatsSubTreeRoot");

  return {
    fixtureId: pickNumber(summary, ["fixtureId"], fixtureId) ?? fixtureId,
    seq,
    ts: pickNumber(obj, ["ts"]),
    participant1Score: scoreFor(STAT_KEY_PARTICIPANT1_SCORE),
    participant2Score: scoreFor(STAT_KEY_PARTICIPANT2_SCORE),
    eventStatsSubTreeRoot: Array.isArray(subTreeRoot) ? subTreeRoot.filter((byte): byte is number => typeof byte === "number") : undefined,
    proofDepth: proofNodes(getValue(obj, "statProof")).length
      + proofNodes(getValue(obj, "subTreeProof")).length
      + proofNodes(getValue(obj, "mainTreeProof")).length,
    raw
  };
}

function decimalPrice(price: number | undefined): number | undefined {
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? Math.round((price / 1000) * 100) / 100 : undefined;
}

function confidenceFromMarket(market: OddsMarket1x2): "low" | "medium" | "high" {
  const favProb = Math.max(market.prob1, market.prob2);
  const gap = Math.abs(market.prob1 - market.prob2);
  if (favProb >= 60 || gap >= 30) {
    return "high";
  }
  if (favProb >= 45 || gap >= 12) {
    return "medium";
  }
  return "low";
}
