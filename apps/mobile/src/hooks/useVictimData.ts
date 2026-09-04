import { useCallback, useEffect, useState } from "react";
import type { CallRouting, CaseWithDetails } from "@samvedna/shared-types";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  enqueueCheckin,
  getOfflineQueue,
  removeFromQueue,
} from "@/lib/offline-queue";

export { PrimaryButton } from "@/components/PrimaryButton";
export { OnlineBadge, ScreenLoader } from "@/components/StatusUI";

export function useVictimData() {
  const { session, isOnline } = useAuth();
  const token = session?.access_token ?? "";
  const [cases, setCases] = useState<CaseWithDetails[]>([]);
  const [routing, setRouting] = useState<CallRouting | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshQueue = useCallback(async () => {
    const q = await getOfflineQueue();
    setQueueCount(q.length);
  }, []);

  const syncQueue = useCallback(async () => {
    if (!isOnline || !token) return;
    const q = await getOfflineQueue();
    for (const item of q) {
      try {
        await apiFetch("/checkins", {
          method: "POST",
          token,
          body: JSON.stringify({
            case_id: item.case_id,
            message: item.message,
            channel: "app",
          }),
        });
        await removeFromQueue(item.id);
      } catch (err) {
        console.warn("[syncQueue]", err);
        break;
      }
    }
    await refreshQueue();
  }, [isOnline, token, refreshQueue]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      if (!isOnline) {
        await refreshQueue();
        setLoading(false);
        return;
      }
      const [caseList, route] = await Promise.all([
        apiFetch<CaseWithDetails[]>("/cases", { token }),
        apiFetch<CallRouting>("/calls/routing", { token }).catch(() => null),
      ]);
      setCases(Array.isArray(caseList) ? caseList : []);
      setRouting(route);
      await syncQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      await refreshQueue();
    }
  }, [token, isOnline, refreshQueue, syncQueue]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isOnline) syncQueue();
  }, [isOnline, syncQueue]);

  const saveCheckin = useCallback(
    async (message: string) => {
      const caseId = cases[0]?.id;
      if (!caseId) throw new Error("No case linked to your account yet.");

      if (!isOnline) {
        await enqueueCheckin({ case_id: caseId, message });
        await refreshQueue();
        return { offline: true as const };
      }

      await apiFetch("/checkins", {
        method: "POST",
        token,
        body: JSON.stringify({
          case_id: caseId,
          message,
          channel: "app",
        }),
      });
      return { offline: false as const };
    },
    [cases, isOnline, token, refreshQueue]
  );

  return {
    cases,
    routing,
    queueCount,
    loading,
    error,
    reload: load,
    saveCheckin,
    syncQueue,
  };
}
