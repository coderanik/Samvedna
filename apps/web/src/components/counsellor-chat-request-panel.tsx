"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { connectSocket, onCounsellorChatRequest } from "@/lib/socket";
import { apiFetch } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MessageCircle, X, Video } from "lucide-react";

type ChatRequest = {
  handoff_id: string;
  victim_id: string;
  victim_name: string;
  case_id: string | null;
  case_number: string | null;
  video_room_url: string;
  message: string;
};

export function CounsellorChatRequestPanel({
  userId,
  token,
}: {
  userId: string;
  token: string;
}) {
  const [requests, setRequests] = useState<ChatRequest[]>([]);

  useEffect(() => {
    connectSocket(userId);
    const off = onCounsellorChatRequest((event) => {
      setRequests((prev) =>
        [event, ...prev.filter((r) => r.handoff_id !== event.handoff_id)].slice(0, 4)
      );
    });

    // Also hydrate from API
    (async () => {
      try {
        const rows = await apiFetch<
          Array<{
            id: string;
            victimId: string;
            victimName: string;
            caseId: string | null;
            caseNumber: string | null;
            status: string;
            videoRoomUrl: string;
          }>
        >("/chat/handoff/pending", { token });
        const pending = rows
          .filter((r) => r.status === "requested")
          .map(
            (r) =>
              ({
                handoff_id: r.id,
                victim_id: r.victimId,
                victim_name: r.victimName,
                case_id: r.caseId,
                case_number: r.caseNumber,
                video_room_url: r.videoRoomUrl,
                message: `${r.victimName} asked to speak with a counsellor in chat.`,
              }) satisfies ChatRequest
          );
        if (pending.length) {
          setRequests((prev) => {
            const byId = new Map(prev.map((p) => [p.handoff_id, p]));
            for (const p of pending) byId.set(p.handoff_id, p);
            return [...byId.values()].slice(0, 4);
          });
        }
      } catch {
        /* ignore */
      }
    })();

    return off;
  }, [userId, token]);

  async function join(id: string) {
    await apiFetch(`/chat/handoff/${id}/join`, { method: "POST", token, body: "{}" });
    setRequests((p) => p.filter((r) => r.handoff_id !== id));
    window.location.href = `/counselor/chat/${id}`;
  }

  if (!requests.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {requests.map((r) => (
        <div
          key={r.handoff_id}
          className="rounded-xl border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] p-4 shadow-lg"
        >
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sanctuary-teal)]" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-[var(--sanctuary-ink)]">Join chat request</p>
              <p className="text-[var(--sanctuary-ink-2)]">
                {r.victim_name}
                {r.case_number ? ` · ${r.case_number}` : ""}
              </p>
              <p className="mt-1 text-xs text-[var(--sanctuary-ink-3)]">{r.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void join(r.handoff_id)}>
                  Join conversation
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={r.video_room_url} target="_blank" rel="noreferrer">
                    <Video className="mr-1 h-3.5 w-3.5" />
                    Video
                  </a>
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/counselor/chat/${r.handoff_id}`}>Open</Link>
                </Button>
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setRequests((p) => p.filter((x) => x.handoff_id !== r.handoff_id))}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
