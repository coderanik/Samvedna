import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "samvedna.offline_checkins";

export interface QueuedCheckin {
  id: string;
  case_id: string;
  message: string;
  created_at: string;
}

export async function getOfflineQueue(): Promise<QueuedCheckin[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedCheckin[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function enqueueCheckin(
  item: Omit<QueuedCheckin, "id" | "created_at">
): Promise<QueuedCheckin> {
  const entry: QueuedCheckin = {
    ...item,
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
  };
  const queue = await getOfflineQueue();
  queue.push(entry);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return entry;
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getOfflineQueue();
  await AsyncStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(queue.filter((q) => q.id !== id))
  );
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
