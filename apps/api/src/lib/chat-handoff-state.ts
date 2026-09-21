/**
 * In-memory chat handoff registry when chat_handoffs table is not migrated yet.
 */
export type HandoffStatus = "requested" | "joined" | "ended";

export interface LiveHandoff {
  id: string;
  victimId: string;
  victimName: string;
  caseId: string | null;
  caseNumber: string | null;
  counsellorId: string | null;
  status: HandoffStatus;
  videoRoomUrl: string;
  createdAt: string;
  joinedAt: string | null;
}

const byId = new Map<string, LiveHandoff>();

export function registerHandoff(row: LiveHandoff) {
  byId.set(row.id, row);
  return row;
}

export function getHandoff(id: string) {
  return byId.get(id) ?? null;
}

export function updateHandoff(id: string, patch: Partial<LiveHandoff>) {
  const cur = byId.get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  byId.set(id, next);
  return next;
}

export function listHandoffsForCounsellor(counsellorId: string) {
  return [...byId.values()]
    .filter(
      (h) =>
        (h.counsellorId === counsellorId || h.counsellorId === null) &&
        (h.status === "requested" || h.status === "joined")
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listOpenHandoffForVictim(victimId: string) {
  return (
    [...byId.values()]
      .filter((h) => h.victimId === victimId && h.status !== "ended")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}
