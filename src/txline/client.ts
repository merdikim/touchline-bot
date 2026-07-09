import type { WorkerEnv } from "../env";
import { normalizeFixtures, normalizeOddsSummary, normalizeScoreState } from "./normalizers";
import type { NormalizedFixture, NormalizedScoreState, OddsSummary } from "./types";

export class TxLineClient {
  constructor(private readonly env: Pick<WorkerEnv, "TXLINE_BASE_URL" | "TXLINE_JWT" | "TXLINE_API_TOKEN">) {}

  async getFixtures(params: { q?: string } = {}): Promise<NormalizedFixture[]> {
    const raw = await this.get("/api/fixtures/snapshot", params);
    return normalizeFixtures(raw);
  }

  async getScoreSnapshot(fixtureId: number): Promise<NormalizedScoreState> {
    const raw = await this.get(`/api/scores/snapshot/${fixtureId}`);
    return normalizeScoreState(fixtureId, raw);
  }

  async getScoreUpdates(fixtureId: number): Promise<NormalizedScoreState[]> {
    const raw = await this.get(`/api/scores/updates/${fixtureId}`);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((item) => normalizeScoreState(fixtureId, item));
  }

  async getHistoricalScores(fixtureId: number): Promise<NormalizedScoreState[]> {
    const raw = await this.get(`/api/scores/historical/${fixtureId}`);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((item) => normalizeScoreState(fixtureId, item));
  }

  async getOddsSnapshot(fixtureId: number, asOf?: string, participant1 = "Participant 1", participant2 = "Participant 2"): Promise<OddsSummary> {
    const raw = await this.get(`/api/odds/snapshot/${fixtureId}`, { asOf });
    return normalizeOddsSummary(raw, participant1, participant2);
  }

  async getOddsUpdates(fixtureId: number): Promise<OddsSummary[]> {
    const raw = await this.get(`/api/odds/updates/${fixtureId}`);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((item) => normalizeOddsSummary(item, "Participant 1", "Participant 2"));
  }

  async getScoreValidation(params: Record<string, string | number>): Promise<unknown> {
    return this.get("/api/scores/stat-validation", Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])));
  }

  private async get(path: string, params: Record<string, string | undefined> = {}): Promise<unknown> {
    const url = new URL(path, this.env.TXLINE_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.TXLINE_JWT}`,
        "X-Api-Token": this.env.TXLINE_API_TOKEN,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TxLINE ${response.status}: ${body.slice(0, 500)}`);
    }

    return response.json();
  }
}
