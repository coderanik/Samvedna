"use client";

import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "@/lib/utils";
import type { NewAlertEvent, IncomingCallEvent } from "@samvedna/shared-types";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { autoConnect: false });
  }
  return socket;
}

export function connectSocket(userId: string) {
  const s = getSocket();
  if (!s.connected) s.connect();
  s.emit("join_user_room", userId);
  return s;
}

export function joinCaseRoom(caseId: string) {
  getSocket().emit("join_case_room", { case_id: caseId });
}

export function onNewAlert(callback: (event: NewAlertEvent) => void) {
  getSocket().on("new_alert", callback);
  return () => {
    getSocket().off("new_alert", callback);
  };
}

export function onIncomingCall(callback: (event: IncomingCallEvent) => void) {
  getSocket().on("incoming_call", callback);
  return () => {
    getSocket().off("incoming_call", callback);
  };
}

export function onCallAccepted(callback: (payload: { call_session_id: string; counsellor_id: string | null }) => void) {
  getSocket().on("call_accepted", callback);
  return () => {
    getSocket().off("call_accepted", callback);
  };
}
