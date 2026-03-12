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
  token?: string;
  error?: string;
  user?: { telegram_id: number; first_name: string; role: string; employee_id: string; is_owner: boolean };
}

export async function authenticate(): Promise<AuthResult> {
  const res = await fetch("/api/miniapp/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData }) });
  const data: AuthResult = await res.json();
  if (data.ok && data.token) { cachedToken = data.token; sessionStorage.setItem(TOKEN_KEY, data.token); }
  return data;
}

export function clearToken() { cachedToken = null; sessionStorage.removeItem(TOKEN_KEY); }

async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(path, { headers: getHeaders() });
  if (res.status === 401) { clearToken(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: getHeaders(), body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { clearToken(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiPut<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(path, { method: "PUT", headers: getHeaders(), body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { clearToken(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE", headers: getHeaders() });
  if (res.status === 401) { clearToken(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Dashboard ──
export interface DashboardData {
  kpi: { employee_count: number; total_payroll: number; total_hours: number; pending_payments: number };
  team: Array<{ id: string; name: string; role: string; hours: number; pay: number }>;
  week_state?: string;
}
export const getDashboard = () => apiGet<DashboardData>("/api/miniapp/dashboard");

// ── Schedule (rich) ──
export interface SlotData {
  morning: string | null; morning_id: string | null;
  evening: string | null; evening_id: string | null;
  cleaning: boolean;
  morning_status: string; evening_status: string;
  morning_problem: boolean; evening_problem: boolean;
  morning_available: Array<{ id: string; name: string }>;
  evening_available: Array<{ id: string; name: string }>;
}
export interface ScheduleData {
  week: string; week_start: string; today_dow?: string;
  slots: Record<string, SlotData>;
  employee_hours?: Record<string, { hours: number; min: number }>;
}
export const getSchedule = (ws?: string) => apiGet<ScheduleData>(`/api/miniapp/schedule${ws ? `?week_start=${ws}` : ""}`);
export const publishSchedule = (ws: string) => apiPost("/api/miniapp/schedule/publish", { week_start: ws });
export const proposeSchedule = (ws: string) => apiPost("/api/miniapp/schedule/propose", { week_start: ws });
export const lockSchedule = (ws: string) => apiPost("/api/miniapp/schedule/lock", { week_start: ws });
export const resetSchedule = (ws: string) => apiPost("/api/miniapp/schedule/reset", { week_start: ws });
export const updateSlot = (ws: string, day: string, slot: string, eid: string | null, cleaning?: boolean) =>
  apiPut("/api/miniapp/schedule/slot", { week_start: ws, day, slot, employee_id: eid, cleaning });

// ── Employees ──
export interface Employee {
  id: string; name: string; role: string;
  rate_per_hour?: number; min_hours_per_week?: number; max_hours_per_week?: number;
  auto_schedule?: boolean; branch?: string; telegram_user_id?: string | null; skill_level?: string;
}
export const getEmployees = (full = false) => apiGet<Employee[]>(`/api/miniapp/employees${full ? "?full=true" : ""}`);
export const createEmployee = (data: Partial<Employee>) => apiPost("/api/miniapp/employees", data);
export const updateEmployee = (id: string, data: Partial<Employee>) => apiPut(`/api/miniapp/employees/${id}`, data);
export const deleteEmployee = (id: string) => apiDelete(`/api/miniapp/employees/${id}`);

// ── Payroll ──
export interface ExtraWorkItem { id: string; work_name: string; price: number; date?: string; status: string; comment?: string }
export interface ExtraPayItem { id: string; amount: number; date?: string; comment?: string }
export interface PayrollEmployee {
  user_id: string; name: string;
  shift_hours: number; effective_hours: number; problem_shifts: number; rate: number;
  shift_pay: number; cleaning_count: number; cleaning_pay: number;
  extra_classes_count: number; extra_classes_total_kids: number; extra_classes_total_pay: number;
  extra_work: ExtraWorkItem[]; extra_work_approved_pay: number;
  extra_pay: ExtraPayItem[]; extra_pay_total: number;
  inter_branch_hours: number; inter_branch_pay: number;
  total_pay: number;
}
export interface PayrollData {
  period: string; totals: { total_hours: number; total_pay: number };
  employees: PayrollEmployee[];
}
export const getPayroll = (ws?: string, period?: string) =>
  apiGet<PayrollData>(`/api/miniapp/payroll?${ws ? `week_start=${ws}&` : ""}${period ? `period=${period}` : ""}`);

// ── Extra pay / extra work ──
export const addExtraPay = (data: { user_id: string; amount?: number; comment?: string; date?: string; work_type_id?: string; work_name?: string; price?: number }) =>
  apiPost("/api/miniapp/extra-pay", data);
export const approveExtraWork = (id: string) => apiPut(`/api/miniapp/extra-pay/${id}/approve`);
export const rejectExtraWork = (id: string) => apiPut(`/api/miniapp/extra-pay/${id}/reject`);
export const deleteExtraPay = (id: string) => apiDelete(`/api/miniapp/extra-pay/${id}`);

// ── Catalog ──
export interface CatalogItem { id: string; name: string; price: number }
export const getCatalog = () => apiGet<CatalogItem[]>("/api/miniapp/catalog");

// ── Payments ──
export interface PaymentsData {
  date: string; groups: Array<{ name: string; time: string; students: Array<{ name: string; status: string; amount?: number }> }>;
  total_students: number; total_amount: number;
}
export const getPayments = (date?: string) => apiGet<PaymentsData>(`/api/miniapp/payments${date ? `?date=${date}` : ""}`);
export const sendPaymentsList = (date: string) => apiPost("/api/miniapp/payments/send-list", { date });

// ── Groups (Paraplan config) ──
export interface GroupConfig {
  paraplan_id: string;
  name: string;
  prefix: string;
  requires_junior: boolean;
  required_skill_level: string | null;
  subscription_price?: number | null;
  single_price?: number | null;
  price_type?: "subscription" | "single";
}
export const getGroups = () => apiGet<GroupConfig[]>("/api/miniapp/groups");
export const updateGroupJunior = (id: string, requires_junior: boolean) =>
  apiPut(`/api/miniapp/groups/${id}`, { requires_junior });
export const updateGroupField = (id: string, field: string, value: any) =>
  apiPut(`/api/miniapp/groups/${id}`, { [field]: value });

// ── Settings ──
export const getSettings = () => apiGet<Record<string, any>>("/api/miniapp/settings");
export const updateSetting = (key: string, value: any) => apiPut("/api/miniapp/settings", { key, value });
export const getBotMode = () => apiGet<{ mode: string }>("/api/miniapp/bot-mode");
export const setBotMode = (mode: string) => apiPost<{ ok: boolean; mode: string }>("/api/miniapp/bot-mode", { mode });
