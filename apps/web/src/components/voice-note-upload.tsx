"use client";

import { useRef, useState } from "react";
import { API_URL } from "@/lib/utils";

type VoiceNoteResult = {
  analysis?: { vocal_stress_index?: number | null; confidence?: string };
  baseline?: { sample_count?: number; personal_baseline_active?: boolean } | null;
  honesty?: string;
};

/**
 * Record a short voice note and POST to /cases/:id/voice-note for prosody + baseline.
 * Victims never see numeric stress scores — only calm status copy.
 */
export function VoiceNoteUpload({
  caseId,
  token,
  forCounsellor = false,
}: {
  caseId: string;
  token: string;
  /** When true, show stress index (staff only). */
  forCounsellor?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<VoiceNoteResult | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setStatus("");
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await upload(blob);
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setStatus("Microphone permission is needed to leave a voice note.");
    }
  }

  function stop() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  async function upload(blob: Blob) {
    if (!caseId || !token) return;
    setBusy(true);
    setStatus("Listening to your note…");
    try {
      const form = new FormData();
      form.append("audio", blob, "voice-note.webm");
      const res = await fetch(`${API_URL}/cases/${caseId}/voice-note`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "Upload failed");
      }
      const data = (await res.json()) as VoiceNoteResult;
      setResult(data);
      const n = data.baseline?.sample_count ?? 0;
      if (forCounsellor) {
        setStatus(
          data.baseline?.personal_baseline_active
            ? `Personal baseline active (${n} samples).`
            : `Baseline building — ${n}/3 samples.`
        );
      } else {
        setStatus(
          n >= 3
            ? "Your voice note was received. Thank you."
            : "Voice note saved. A few more notes help us understand your usual tone."
        );
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save voice note.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await upload(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] p-4">
      <p className="font-display text-base text-[var(--sanctuary-ink)]">Voice note</p>
      <p className="text-sm text-[var(--sanctuary-ink-2)]">
        Optional. A short spoken check-in — no score shown to you.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={start}
            disabled={busy || !token}
            className="text-sm text-[var(--sanctuary-teal)] underline underline-offset-4 disabled:opacity-40"
          >
            Record
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="text-sm text-[var(--sanctuary-terracotta)] underline underline-offset-4"
          >
            Stop & send
          </button>
        )}
        <label className="cursor-pointer text-sm text-[var(--sanctuary-ink-2)] underline underline-offset-4">
          Or upload audio
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={onFile}
            disabled={busy || recording}
          />
        </label>
      </div>
      {status && <p className="text-xs text-[var(--sanctuary-ink-3)]">{status}</p>}
      {forCounsellor && result?.analysis?.vocal_stress_index != null && (
        <p className="text-xs text-[var(--sanctuary-ink-2)]">
          Vocal stress index: {Math.round(result.analysis.vocal_stress_index)} ·{" "}
          {result.analysis.confidence}
        </p>
      )}
      {forCounsellor && result?.honesty && (
        <p className="text-[11px] leading-relaxed text-[var(--sanctuary-ink-3)]">{result.honesty}</p>
      )}
    </div>
  );
}
