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

export function joinHandoffRoom(handoffId: string) {
  getSocket().emit("join_handoff_room", { handoff_id: handoffId });
}

export function onCounsellorChatRequest(
  callback: (event: {
    handoff_id: string;
    victim_id: string;
    victim_name: string;
    case_id: string | null;
    case_number: string | null;
    video_room_url: string;
    message: string;
  }) => void
) {
  getSocket().on("counsellor_chat_request", callback);
  return () => {
    getSocket().off("counsellor_chat_request", callback);
  };
}

export function onCounsellorJoinedChat(
  callback: (event: {
    handoff_id: string;
    counsellor_id: string;
    video_room_url?: string;
  }) => void
) {
  getSocket().on("counsellor_joined_chat", callback);
  return () => {
    getSocket().off("counsellor_joined_chat", callback);
  };
}

export function onVictimAssigned(
  callback: (event: import("@samvedna/shared-types").VictimAssignedEvent) => void
) {
  getSocket().on("victim_assigned", callback);
  return () => {
    getSocket().off("victim_assigned", callback);
  };
}

export function onChatHandoffMessage(
  callback: (event: {
    handoff_id: string;
    message: { id: string; role: string; content: string; created_at: string };
  }) => void
) {
  getSocket().on("chat_handoff_message", callback);
  return () => {
    getSocket().off("chat_handoff_message", callback);
  };
}
