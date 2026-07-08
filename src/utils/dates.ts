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

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

export function toUtcEpochDay(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
}

export function startEpochDayFromDateQuery(dateQuery: string | null | undefined, now = new Date()): number | undefined {
  if (!dateQuery?.trim()) {
    return undefined;
  }

  const query = dateQuery.trim().toLowerCase();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (query === "today" || query === "now" || query === "current") {
    return Math.floor(today / MS_PER_DAY);
  }
  if (query === "tomorrow") {
    return Math.floor((today + MS_PER_DAY) / MS_PER_DAY);
  }

  const inDays = query.match(/^in\s+(\d+)\s+days?$/);
  if (inDays) {
    return Math.floor((today + Number(inDays[1]) * MS_PER_DAY) / MS_PER_DAY);
  }

  if (query === "this weekend" || query === "weekend") {
    const dayOfWeek = new Date(today).getUTCDay();
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
    return Math.floor((today + daysUntilSaturday * MS_PER_DAY) / MS_PER_DAY);
  }

  if (query === "next week") {
    return Math.floor((today + 7 * MS_PER_DAY) / MS_PER_DAY);
  }

  const isoDate = query.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    return epochDayFromParts(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }

  const monthDate = query.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (monthDate) {
    const month = MONTHS[monthDate[1]];
    if (month === undefined) {
      return undefined;
    }

    const day = Number(monthDate[2]);
    let year = monthDate[3] ? Number(monthDate[3]) : now.getUTCFullYear();
    let epochDay = epochDayFromParts(year, month, day);
    if (!monthDate[3] && epochDay !== undefined && epochDay < Math.floor(today / MS_PER_DAY)) {
      year += 1;
      epochDay = epochDayFromParts(year, month, day);
    }
    return epochDay;
  }

  return undefined;
}

function epochDayFromParts(year: number, month: number, day: number): number | undefined {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return undefined;
  }
  return toUtcEpochDay(date);
}
