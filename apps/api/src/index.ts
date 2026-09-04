import "./env";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";

import { errorHandler } from "./lib/errors";
import { checkinsRouter } from "./routes/checkins";
import { casesRouter } from "./routes/cases";
import { alertsRouter } from "./routes/alerts";
import { dashboardRouter } from "./routes/dashboard";
import { webhooksRouter } from "./routes/webhooks";
import { adminRouter } from "./routes/admin";
import { chatRouter } from "./routes/chat";
import { callsRouter } from "./routes/calls";
import { supabaseAdmin } from "./lib/supabase";

const PORT = parseInt(process.env.PORT ?? "4000", 10);
const CORS_ORIGINS = (
  process.env.SOCKET_CORS_ORIGIN ??
  "http://localhost:3000,http://localhost:3001,http://localhost:3002"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: { origin: CORS_ORIGINS, credentials: true },
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "samvedna-api", timestamp: new Date().toISOString() });
});

app.use("/checkins", checkinsRouter(io));
app.use("/chat", chatRouter());
app.use("/calls", callsRouter(io));
app.use("/cases", casesRouter());
app.use("/alerts", alertsRouter());
app.use("/dashboard", dashboardRouter());
app.use("/webhooks", webhooksRouter(io));
app.use("/admin", adminRouter());

app.use(errorHandler);

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on("join_user_room", (userId: string) => {
    socket.join(`user:${userId}`);
  });

  socket.on("join_case_room", (payload: { case_id: string }) => {
    if (payload?.case_id) {
      socket.join(`case:${payload.case_id}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Samvedna API running on http://localhost:${PORT}`);
  console.log(`Socket.io CORS origins: ${CORS_ORIGINS.join(", ")}`);
});

export { io, supabaseAdmin };
