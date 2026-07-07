import type { matches } from "../db/schema";

export function displayName(user: { first_name?: string; last_name?: string; username?: string } | undefined): string {
  if (!user) {
    return "A fan";
  }
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || "A fan";
}

export function matchTitle(match: Pick<typeof matches.$inferSelect, "participant1" | "participant2">) {
  return `${match.participant1} vs ${match.participant2}`;
}
