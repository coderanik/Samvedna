import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";
export const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "http://localhost:8001";

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...rest } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...rest, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

export const RISK_COLORS: Record<string, string> = {
  low: "bg-risk-low/15 text-risk-low border-risk-low/30",
  moderate: "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/30",
  high: "bg-risk-high/15 text-risk-high border-risk-high/30",
  critical: "bg-risk-critical/15 text-risk-critical border-risk-critical/30",
};

export const CRISIS_HELPLINE = "1800-599-0019";
