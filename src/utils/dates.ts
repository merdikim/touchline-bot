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
