export const CRON_SLOTS_UTC = [
  { month: 8, day: 29, hour: 0, minute: 0 },
  { month: 8, day: 30, hour: 0, minute: 0 },
  { month: 8, day: 30, hour: 3, minute: 0 },
  { month: 8, day: 30, hour: 6, minute: 0 },
  { month: 8, day: 30, hour: 9, minute: 0 },
  { month: 8, day: 30, hour: 12, minute: 0 },
  { month: 8, day: 31, hour: 0, minute: 10 },
  { month: 8, day: 31, hour: 3, minute: 0 },
  { month: 8, day: 31, hour: 5, minute: 59 },
  { month: 8, day: 31, hour: 8, minute: 51 },
  { month: 8, day: 31, hour: 12, minute: 3 },
  { month: 9, day: 1, hour: 0, minute: 3 },
  { month: 9, day: 1, hour: 3, minute: 5 },
  { month: 9, day: 1, hour: 6, minute: 30 },
  { month: 9, day: 1, hour: 9, minute: 2 },
  { month: 9, day: 1, hour: 12, minute: 1 },
  { month: 9, day: 1, hour: 23, minute: 52 },
  { month: 9, day: 2, hour: 3, minute: 6 },
  { month: 9, day: 2, hour: 6, minute: 2 },
  { month: 9, day: 2, hour: 8, minute: 55 },
  { month: 9, day: 2, hour: 12, minute: 2 },
  { month: 9, day: 2, hour: 23, minute: 51 },
  { month: 9, day: 3, hour: 2, minute: 50 },
  { month: 9, day: 3, hour: 5, minute: 54 },
  { month: 9, day: 3, hour: 8, minute: 51 },
  { month: 9, day: 3, hour: 11, minute: 50 },
  { month: 9, day: 3, hour: 23, minute: 54 },
  { month: 9, day: 4, hour: 3, minute: 3 },
  { month: 9, day: 4, hour: 5, minute: 54 },
  { month: 9, day: 4, hour: 8, minute: 55 },
  { month: 9, day: 4, hour: 12, minute: 10 },
  { month: 9, day: 5, hour: 0, minute: 4 },
  { month: 9, day: 5, hour: 2, minute: 59 },
  { month: 9, day: 5, hour: 5, minute: 59 },
  { month: 9, day: 5, hour: 9, minute: 0 },
  { month: 9, day: 5, hour: 11, minute: 58 },
  { month: 9, day: 6, hour: 0, minute: 8 },
  { month: 9, day: 6, hour: 3, minute: 10 },
  { month: 9, day: 6, hour: 6, minute: 4 },
  { month: 9, day: 6, hour: 8, minute: 52 },
  { month: 9, day: 6, hour: 11, minute: 55 },
  { month: 9, day: 7, hour: 0, minute: 9 },
  { month: 9, day: 7, hour: 2, minute: 58 },
  { month: 9, day: 7, hour: 6, minute: 10 },
  { month: 9, day: 7, hour: 8, minute: 54 },
  { month: 9, day: 7, hour: 12, minute: 2 },
];

// NOTE: keep this list in sync with vercel.json's `crons` entries whenever the
// schedule is regenerated/extended. Used only to *predict* which slot a queued
// post will land in — the cron job itself is the source of truth for what
// actually fires.
export function getUpcomingSlots(count) {
  const now = new Date();
  const year = now.getUTCFullYear();
  return CRON_SLOTS_UTC
    .map((s) => new Date(Date.UTC(year, s.month - 1, s.day, s.hour, s.minute, 0)))
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a - b)
    .slice(0, count);
}
