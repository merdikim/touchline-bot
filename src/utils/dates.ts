export function isBeforeKickoff(startTime: string, now = new Date()): boolean {
  const kickoff = new Date(startTime);
  return Number.isFinite(kickoff.getTime()) && now < kickoff;
}

export function formatKickoff(startTime: string): string {
  const date = new Date(startTime);
  if (!Number.isFinite(date.getTime())) {
    return startTime;
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;


export function toUtcEpochDay(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
}
