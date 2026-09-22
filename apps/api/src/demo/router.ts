import { Router, type Request, type Response } from "express";
import {
  DEMO_USERS,
  alertsFor,
  callRouting,
  chatHistory,
  consultantPayload,
  dashboardSummary,
  demoUserFromToken,
  explain,
  forecast,
  goneQuiet,
  pendingCalls,
  timeline,
  victimDashboard,
  victimProfile,
  visibleCases,
  type DemoUser,
} from "./data";

function actor(req: Request, res: Response): DemoUser | undefined {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = demoUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Sign in with a demo account. This API is using the local fallback database." });
    return;
  }
  return user;
}

function forbid(res: Response) {
  res.status(403).json({ error: "Insufficient permissions" });
}

export function demoFallbackRouter() {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      service: "samvedna-api",
      mode: "demo-fallback",
      website: "http://localhost:3000",
      health: "/health",
    });
  });

  router.get("/victim/dashboard", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    if (user.role !== "victim") return forbid(res);
    res.json(victimDashboard(user.id));
  });

  router.post("/victim/instant-calls/start", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    if (user.role !== "victim") return forbid(res);
    res.status(201).json({
      instant_call: { id: "instant-demo", status: "in_progress" },
      call_session: { id: "session-demo" },
      mode: "browser",
      preferred_language: user.preferred_language,
      honesty: "DEMO — in-browser Mann-Mitra. Phone calls need a real Twilio setup.",
    });
  });

  router.post("/victim/instant-calls/:id/complete", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({
      id: req.params.id,
      status: "completed",
      summary: "Demo call saved locally. A live summary needs the voice service.",
      duration_seconds: req.body?.duration_seconds ?? null,
    });
  });

  router.get("/victim/instant-calls/capabilities", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({
      browser_voice: true,
      twilio_outbound: false,
      twilio_live: false,
      has_phone: Boolean(user.phone_number),
      preferred_mode: "browser",
      label: "DEMO",
    });
  });

  router.get("/victim/exercises", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({
      tags: [{ tag: "anxiety" }, { tag: "sleep" }],
      recommendations: [
        {
          id: "ex-1",
          tag: "anxiety",
          title: "Box breathing",
          description: "A 4-count breath for the minutes before a hearing or a difficult call.",
          steps: [
            "Sit with both feet on the floor.",
            "Inhale through the nose for 4 counts.",
            "Hold gently for 4 counts.",
            "Exhale for 4 counts.",
            "Repeat 4 rounds.",
          ],
          content_url: null,
          duration_minutes: 5,
        },
        {
          id: "ex-2",
          tag: "sleep",
          title: "Evening wind-down",
          description: "A short routine when sleep will not come.",
          steps: [
            "Dim the room.",
            "Name three things you can see that are safe.",
            "Sip water.",
            "Set one small plan for the morning.",
          ],
          content_url: null,
          duration_minutes: 8,
        },
      ],
      logic: "Local demo recommendations",
    });
  });

  router.get("/victim/consultant/slots", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    res.json(
      [0, 1, 2].map((i) => {
        const begins = new Date(start.getTime() + i * 24 * 3600_000);
        const ends = new Date(begins.getTime() + 45 * 60_000);
        return { id: `slot-${i}`, starts_at: begins.toISOString(), ends_at: ends.toISOString() };
      })
    );
  });

  router.get("/victim/consultant", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(consultantPayload(user.id));
  });

  router.get("/victim/profile", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(victimProfile(user.id));
  });

  router.get("/victim/onboarding/status", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({ completed: true, onboarding_completed_at: "2026-01-15T08:00:00.000Z" });
  });

  router.get("/dashboard/summary", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    if (user.role === "victim") return forbid(res);
    const summary = dashboardSummary();
    const scope = (req.query.scope as string) || "national";
    res.json({ ...summary, scope });
  });

  router.get("/dashboard/geo-filters", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({
      states: ["Rajasthan", "Tamil Nadu", "Uttar Pradesh", "Maharashtra"],
      districts_by_state: {
        Rajasthan: ["Jaipur"],
        "Tamil Nadu": ["Chennai"],
        "Uttar Pradesh": ["Lucknow"],
        Maharashtra: ["Pune"],
      },
    });
  });

  router.get("/dashboard/sla-breaches", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({
      total: 1,
      breaches: [
        {
          id: "sup-2",
          case_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
          case_number: "SAM-2024-003",
          district: "Lucknow",
          state: "Uttar Pradesh",
          type: "protection",
          catalog_code: "POA-PROTECT",
          due_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
          hours_overdue: 4,
          responsible_authority: "District magistrate",
        },
      ],
    });
  });

  router.get("/dashboard/priority-queue", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    if (user.role !== "counsellor" && user.role !== "admin") return forbid(res);
    res.json(visibleCases(user));
  });

  router.get("/outreach/gone-quiet", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(goneQuiet(user));
  });

  router.get("/cases/:id/scores/:scoreId/explain", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(explain(req.params.scoreId));
  });

  router.get("/cases/:id/forecast", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(forecast(req.params.id));
  });

  router.get("/cases/:id/timeline", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    const data = timeline(req.params.id);
    if (!data) return res.status(404).json({ error: "Case not found" });
    res.json(data);
  });

  router.get("/cases", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(visibleCases(user));
  });

  router.get("/alerts", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(alertsFor(user));
  });

  router.get("/admin/users", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    if (user.role !== "admin") return forbid(res);
    res.json(
      DEMO_USERS.map((u) => ({
        id: u.id,
        role: u.role,
        full_name: u.full_name,
        preferred_language: u.preferred_language,
        phone_number: u.phone_number,
        created_at: "2026-01-10T08:00:00.000Z",
      }))
    );
  });

  router.get("/admin/stats", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    if (user.role !== "admin") return forbid(res);
    res.json({
      total_users: DEMO_USERS.length,
      victims: DEMO_USERS.filter((u) => u.role === "victim").length,
      counsellors: DEMO_USERS.filter((u) => u.role === "counsellor").length,
      admins: DEMO_USERS.filter((u) => u.role === "admin").length,
      cases: 4,
      unassigned_cases: 0,
      open_alerts: 2,
    });
  });

  router.get("/calls/routing", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    const routing = callRouting(user.id);
    if (!routing) return res.status(404).json({ error: "No case found for your account" });
    res.json(routing);
  });

  router.get("/calls/pending", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    if (user.role !== "counsellor" && user.role !== "admin") return res.json([]);
    res.json(pendingCalls(user.role === "admin" ? user.id : user.id));
  });

  router.get("/chat/history", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json(chatHistory(user.id));
  });

  router.get("/chat/tags", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json([{ tag: "anxiety" }, { tag: "sleep" }]);
  });

  router.get("/chat/handoff/active", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({ handoff: null });
  });

  router.get("/chat/handoff/pending", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json([]);
  });

  router.post("/chat", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    const message = String(req.body?.message ?? "");
    res.json({
      response: message
        ? "I'm listening. Thank you for saying that. You can stop whenever you want — what you shared can be saved for your care team."
        : "I'm here. Share only what feels safe.",
      tags: ["anxiety"],
      suggest_handoff: false,
      wants_human: false,
    });
  });

  router.post("/chat/handoff", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({
      handoff: {
        id: "handoff-demo",
        status: "requested",
        videoRoomUrl: "https://meet.jit.si/samvedna-demo",
        counsellorId: null,
      },
      already_open: false,
    });
  });

  router.post("/checkins", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    res.json({
      id: "chk-new",
      case_id: req.body?.case_id ?? null,
      message: req.body?.message ?? "",
      saved: true,
    });
  });

  router.post("/calls/start", (req, res) => {
    const user = actor(req, res);
    if (!user) return;
    const routing = callRouting(user.id);
    res.json({
      id: "call-new",
      case_id: routing?.case_id,
      victim_id: user.id,
      counsellor_id: routing?.counsellor?.id ?? null,
      call_type: routing?.call_type ?? "ai_voice",
      status: "in_progress",
      risk_level_at_call: routing?.risk_level ?? "low",
      distress_score_at_call: routing?.distress_score ?? null,
    });
  });

  return router;
}
