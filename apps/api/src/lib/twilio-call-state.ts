/**
 * In-memory Twilio call registry — used when instant_calls table isn't migrated yet.
 * Survives for the lifetime of the API process (demo / local).
 */

export type LiveTwilioCall = {
  id: string;
  userId: string;
  caseId: string;
  callSessionId: string;
  twilioCallSid?: string;
  preferredLanguage: string;
  transcript: string;
  status: string;
  createdAt: string;
};

const byId = new Map<string, LiveTwilioCall>();
const bySid = new Map<string, string>();

export function registerLiveTwilioCall(call: LiveTwilioCall) {
  byId.set(call.id, call);
  if (call.twilioCallSid) bySid.set(call.twilioCallSid, call.id);
}

export function getLiveTwilioCall(id: string | undefined): LiveTwilioCall | null {
  if (!id) return null;
  return byId.get(id) ?? null;
}

export function getLiveTwilioCallBySid(sid: string | undefined): LiveTwilioCall | null {
  if (!sid) return null;
  const id = bySid.get(sid);
  return id ? byId.get(id) ?? null : null;
}

export function bindTwilioSid(id: string, sid: string) {
  const call = byId.get(id);
  if (!call) return;
  call.twilioCallSid = sid;
  bySid.set(sid, id);
}

export function updateLiveTwilioCall(id: string, patch: Partial<LiveTwilioCall>) {
  const call = byId.get(id);
  if (!call) return null;
  Object.assign(call, patch);
  if (patch.twilioCallSid) bySid.set(patch.twilioCallSid, id);
  return call;
}

export function clearLiveTwilioCall(id: string) {
  const call = byId.get(id);
  if (call?.twilioCallSid) bySid.delete(call.twilioCallSid);
  byId.delete(id);
}
