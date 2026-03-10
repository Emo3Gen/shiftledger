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
  user?: {
    telegram_id: number;
    first_name: string;
    role: string;
    employee_id: string;
    is_owner: boolean;
  };
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

async function apiPut<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
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
}
export const getDashboard = () => apiGet<DashboardData>("/api/miniapp/dashboard");

// Schedule (simplified format)
export interface SlotData {
  morning: string | null;
  morning_id: string | null;
  evening: string | null;
  evening_id: string | null;
  cleaning: boolean;
}
export interface ScheduleData {
  week: string;
  week_start: string;
  today_dow?: string;
  slots: Record<string, SlotData>;
}
export const getSchedule = (weekStart?: string) =>
  apiGet<ScheduleData>(`/api/miniapp/schedule${weekStart ? `?week_start=${weekStart}` : ""}`);

export const publishSchedule = (weekStart: string) =>
  apiPost("/api/miniapp/schedule/publish", { week_start: weekStart });

export interface SlotUpdateResult {
  ok: boolean;
  slot: { day: string; slot: string; name: string | null; employee_id: string | null; cleaning: boolean };
}
export const updateSlot = (weekStart: string, day: string, slot: string, employeeId: string | null, cleaning?: boolean) =>
  apiPut<SlotUpdateResult>("/api/miniapp/schedule/slot", {
    week_start: weekStart,
    day,
    slot,
    employee_id: employeeId,
    cleaning,
  });

// Employees
export interface Employee {
  id: string;
  name: string;
  role: string;
}
export const getEmployees = () => apiGet<Employee[]>("/api/miniapp/employees");

// Payments
export interface PaymentsData {
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

export const sendPaymentsList = (date: string) =>
  apiPost("/api/miniapp/payments/send-list", { date });

// Payroll
export interface PayrollData {
  period: string;
  totals: { total_hours: number; total_pay: number };
  employees: Array<{
    user_id: string;
    name: string;
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

// Settings (uses existing backend endpoints, but through miniapp auth-free path)
export interface SettingsData {
  [key: string]: any;
}
export const getSettings = () => apiGet<SettingsData>("/api/miniapp/settings");
export const updateSetting = (key: string, value: any) =>
  apiPut("/api/miniapp/settings", { key, value });

export const getBotMode = () => apiGet<{ mode: string }>("/api/miniapp/bot-mode");
export const setBotMode = (mode: string) => apiPost<{ ok: boolean; mode: string }>("/api/miniapp/bot-mode", { mode });
