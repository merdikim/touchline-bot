import { and, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matches } from "../db/schema";
import type { TxLineClient } from "../txline/client";
import type { NormalizedFixture } from "../txline/types";
import { newId } from "../utils/ids";

type Db = ReturnType<typeof createDb>;

export type MatchSelection =
  | { kind: "selected"; groupMatch: typeof groupMatches.$inferSelect; match: typeof matches.$inferSelect }
  | { kind: "ambiguous"; fixtures: NormalizedFixture[] }
  | { kind: "none" };

export class MatchService {
  constructor(private readonly db: Db, private readonly txline: TxLineClient) {}

  async createGroupMatch(groupId: string, matchQuery: string): Promise<MatchSelection> {
    const fixtures = await this.txline.getFixtures({ q: matchQuery });
    if (fixtures.length === 0) {
      return { kind: "none" };
    }
    if (fixtures.length > 1) {
      const ranked = this.rankFixtures(fixtures, matchQuery);
      if (!ranked[0] || ranked[0].score < 2 || ranked[0].score === ranked[1]?.score) {
        return { kind: "ambiguous", fixtures: ranked.slice(0, 5).map((item) => item.fixture) };
      }
      return this.storeSelection(groupId, ranked[0].fixture);
    }
    return this.storeSelection(groupId, fixtures[0]);
  }

  async getActiveForGroup(groupId: string) {
    const [row] = await this.db
      .select({ groupMatch: groupMatches, match: matches })
      .from(groupMatches)
      .innerJoin(matches, eq(groupMatches.matchId, matches.id))
      .where(and(eq(groupMatches.groupId, groupId), eq(groupMatches.status, "active")))
      .limit(1);
    return row ?? null;
  }

  private async storeSelection(groupId: string, fixture: NormalizedFixture): Promise<MatchSelection> {
    const matchId = `txline_match_${fixture.fixtureId}`;
    await this.db.insert(matches).values({
      id: matchId,
      txlineFixtureId: fixture.fixtureId,
      competitionId: fixture.competitionId ?? null,
      competition: fixture.competition ?? null,
      participant1: fixture.participant1,
      participant2: fixture.participant2,
      participant1IsHome: fixture.participant1IsHome ? 1 : 0,
      startTime: fixture.startTime,
      status: "scheduled",
      rawFixture: JSON.stringify(fixture.raw)
    }).onConflictDoUpdate({
      target: matches.txlineFixtureId,
      set: {
        competition: fixture.competition ?? null,
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        startTime: fixture.startTime,
        rawFixture: JSON.stringify(fixture.raw),
        updatedAt: new Date().toISOString()
      }
    });

    const existing = await this.getActiveForGroup(groupId);
    if (existing) {
      await this.db.update(groupMatches).set({ status: "archived", updatedAt: new Date().toISOString() }).where(eq(groupMatches.id, existing.groupMatch.id));
    }

    const odds = await this.txline.getOddsSnapshot(fixture.fixtureId, undefined, fixture.participant1, fixture.participant2).catch(() => null);
    const groupMatchId = newId("group_match");
    await this.db.insert(groupMatches).values({
      id: groupMatchId,
      groupId,
      matchId,
      status: "active",
      predictionsOpen: 1,
      baselineOddsSummary: odds ? JSON.stringify(odds) : null
    });

    const [groupMatch] = await this.db.select().from(groupMatches).where(eq(groupMatches.id, groupMatchId)).limit(1);
    const [match] = await this.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    return { kind: "selected", groupMatch, match };
  }

  private rankFixtures(fixtures: NormalizedFixture[], query: string) {
    const lower = query.toLowerCase();
    return fixtures
      .map((fixture) => ({
        fixture,
        score: [fixture.participant1, fixture.participant2].reduce((total, name) => total + (lower.includes(name.toLowerCase()) ? 2 : 0), 0)
      }))
      .sort((a, b) => b.score - a.score);
  }
}
