export type PollScheduleDecision = { sourceId: string; shouldPoll: boolean; reason: string };
export function createPhaseOnePollDecision(sourceId: string): PollScheduleDecision { return { sourceId, shouldPoll: false, reason: "Polling orchestration starts after Phase 1" }; }
