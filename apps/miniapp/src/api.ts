/**
 * API client for ShiftLedger Mini App.
 */

import { initData } from "./telegram";

const TOKEN_KEY = "miniapp_token";

let cachedToken: string | null = sessionStorage.getItem(TOKEN_KEY);

function getHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cachedToken) h["Authorization"] = `Bearer ${cachedToken}`;
  return h;
}

export interface AuthResult {
  ok: boolean;
  role?: "owner" | "admin";
  token?: string;
  employee_id?: string;
  display_name?: string;
  error?: string;
}

export async function authenticate(): Promise<AuthResult> {
  const res = await fetch("/api/miniapp/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  const data: AuthResult = await res.json();
  if (data.ok && data.token) {
    cachedToken = data.token;
    sessionStorage.setItem(TOKEN_KEY, data.token);
  }
  return data;
}

export function clearToken() {
  cachedToken = null;
  sessionStorage.removeItem(TOKEN_KEY);
}

async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(path, { headers: getHeaders() });
  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// Dashboard
export interface DashboardData {
  ok: boolean;
  kpi: {
    employee_count: number;
    total_payroll: number;
    total_hours: number;
    pending_payments: number;
  };
  team: Array<{
    id: string;
    name: string;
    role: string;
    hours: number;
    pay: number;
  }>;
  week_state?: string;
  week_start?: string;
}
export const getDashboard = () => apiGet<DashboardData>("/api/miniapp/dashboard");

// Schedule
export interface ScheduleData {
  ok: boolean;
  week_start: string;
  today_dow?: string;
  slots: Array<{
    dow: string;
    slot_name: string;
    from: string;
    to: string;
    user_id?: string;
    user_name?: string;
    status?: string;
    replaced_user_id?: string;
    replaced_user_name?: string;
    hours?: number;
    cleaning_user_id?: string;
    cleaning_user_name?: string;
  }>;
}
export const getSchedule = (weekStart?: string) =>
  apiGet<ScheduleData>(`/api/miniapp/schedule${weekStart ? `?week_start=${weekStart}` : ""}`);

export const publishSchedule = (weekStart: string, chatId?: string) =>
  apiPost("/api/schedule/publish", { week_start: weekStart, chat_id: chatId });

// Payments
export interface PaymentsData {
  ok: boolean;
  date: string;
  groups: Array<{
    name: string;
    time: string;
    students: Array<{
      name: string;
      status: string;
      amount?: number;
    }>;
  }>;
  total_students: number;
  total_amount: number;
}
export const getPayments = (date?: string) =>
  apiGet<PaymentsData>(`/api/miniapp/payments${date ? `?date=${date}` : ""}`);

export const sendPaymentsList = (date: string, chatId?: string, threadId?: string) =>
  apiPost("/api/payments/send-list", { date, chat_id: chatId, thread_id: threadId });

// Payroll
export interface PayrollData {
  ok: boolean;
  period: string;
  week_start: string;
  totals: { total_hours: number; total_pay: number };
  employees: Array<{
    user_id: string;
    name: string;
    shift_hours: number;
    effective_hours: number;
    shift_pay: number;
    cleaning_count: number;
    cleaning_pay: number;
    extra_pay: number;
    total_pay: number;
  }>;
}
export const getPayroll = (weekStart?: string) =>
  apiGet<PayrollData>(`/api/miniapp/payroll${weekStart ? `?week_start=${weekStart}` : ""}`);
