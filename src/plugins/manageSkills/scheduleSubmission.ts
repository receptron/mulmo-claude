export type ScheduleSubmission = { type: "daily"; time: string } | { type: "interval"; intervalMs: number };
