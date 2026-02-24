import React from "react";

type Tenant = {
  tenant_id: string;
};

type DialogSummary = {
  chat_id: string;
  last_ts?: string;
  last_text?: string;
};

// Функция для перевода статусов недели на русский (3 состояния)
function translateWeekState(state: string): { label: string; color: string; emoji: string } {
  const map: Record<string, { label: string; color: string; emoji: string }> = {
    COLLECTING: { label: "Сбор доступности", color: "#007bff", emoji: "🔵" },
    ACTIVE: { label: "График активен", color: "#28a745", emoji: "🟢" },
    CLOSED: { label: "Неделя закрыта", color: "#6c757d", emoji: "⚪" },
  };
  return map[state] || { label: state, color: "#666", emoji: "❓" };
}

// UserDirectory для отображения имен сотрудников
const UserDirectory = {
  users: new Map<string, { id: string; displayName: string; ratePerHour: number; role: string; minHours: number }>([
    ["u1", { id: "u1", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 22 }],
    ["u2", { id: "u2", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["u3", { id: "u3", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["u4", { id: "u4", displayName: "Карина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["isa", { id: "u1", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 22 }],
    ["daria", { id: "u2", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["ksu", { id: "u3", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["karina", { id: "u4", displayName: "Карина", ratePerHour: 280, role: "junior", minHours: 20 }],
  ]),
  getDisplayName(userId: string): string {
    const user = this.users.get(userId);
    if (user) return user.displayName;
    // Если не найден, показываем с пометкой
    return `Неизвестный сотрудник (${userId})`;
  },
  getAllUsers(): Array<{ id: string; displayName: string; ratePerHour: number; role: string; minHours: number }> {
    const seen = new Set<string>();
    const result: Array<{ id: string; displayName: string; ratePerHour: number; role: string; minHours: number }> = [];
    for (const [key, user] of this.users.entries()) {
      if (user.id.startsWith("u") && !seen.has(user.id)) {
        seen.add(user.id);
        result.push(user);
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  },
};

// Formatting helpers for payroll table
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  // Show 1 decimal for non-integer, none for integer
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}
function fmtRub(n: number | null | undefined): string {
  if (n == null || n === 0) return "0 ₽";
  const s = Math.round(n).toString();
  // Add thousands separator (space)
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return parts.join("\u2009") + " ₽"; // thin space separator
}

export const App: React.FC = () => {
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = React.useState<string | null>(null);
  const [dialogs, setDialogs] = React.useState<DialogSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<any[]>([]);
  const [inputText, setInputText] = React.useState("");
  const [senderRole, setSenderRole] = React.useState<string>("staff");
  const [lastSend, setLastSend] = React.useState<{
    event?: any;
    facts?: any[];
    facts_count?: number;
  } | null>(null);
  const [backendOk, setBackendOk] = React.useState<boolean | null>(null);
  const [schedule, setSchedule] = React.useState<{
    week_start?: string;
    assignments?: any[];
    gaps?: any[];
    conflicts?: any[];
    slots?: any[];
  } | null>(null);
  const [weekStateResp, setWeekStateResp] = React.useState<any>(null);
  const [weekStateErr, setWeekStateErr] = React.useState<string>("");
  const [timesheet, setTimesheet] = React.useState<any>(null);
  const [timesheetErr, setTimesheetErr] = React.useState<string>("");
  const [weekStartISO, setWeekStartISO] = React.useState<string>("2026-02-09");
  const [reminders, setReminders] = React.useState<Map<string, NodeJS.Timeout>>(new Map());
  const [escalations, setEscalations] = React.useState<Map<string, NodeJS.Timeout>>(new Map());
  const [pendingUsers, setPendingUsers] = React.useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = React.useState<"schedule" | "timesheet" | "empty">("schedule");
  
  // ActiveTasks: неблокирующие задачи вместо эскалаций
  type TaskStatus = "OPEN" | "RESOLVED";
  type TaskSeverity = "warning" | "error";
  interface ActiveTask {
    id: string;
    title: string;
    severity: TaskSeverity;
    createdAt: number;
    updatedAt: number;
    status: TaskStatus;
    counter: number;
    nextReminderAt: number; // timestamp для кулдауна
    payload?: {
      comment?: string;
      reason?: string;
      userId?: string;
      weekStart?: string;
    };
  }
  const [activeTasks, setActiveTasks] = React.useState<Map<string, ActiveTask>>(new Map());
  // Track problem reports per user to show confirmation banners
  const [problemReported, setProblemReported] = React.useState<Map<string, { reported: boolean; timestamp: number; message: string }>>(new Map());
  const [weekStart, setWeekStart] = React.useState<string>(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return monday.toISOString().split("T")[0];
  });
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [factsPerEvent, setFactsPerEvent] = React.useState<Map<number, any[]>>(new Map());
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  // Выбранные сотрудники для расчета графика
  const [selectedRosterUsers, setSelectedRosterUsers] = React.useState<Set<string>>(() => {
    // Загружаем из localStorage или используем всех по умолчанию
    const stored = localStorage.getItem("roster_selected_users");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return new Set(parsed);
      } catch {
        // Если ошибка парсинга, используем всех
      }
    }
    // По умолчанию выбираем всех junior сотрудников
    return new Set(UserDirectory.getAllUsers().filter(u => u.role === "junior").map(u => u.id));
  });

  // Проверка backend /health
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/health");
        setBackendOk(res.ok);
      } catch {
        setBackendOk(false);
      }
    })();
  }, []);

  // Загрузка tenants из /debug/tenants
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/debug/tenants");
        const data = await res.json();
        const t: Tenant[] = data.tenants ?? [];
        setTenants(t);
        if (t.length > 0) {
          setSelectedTenant(t[0].tenant_id);
        }
      } catch (e) {
        console.error("Failed to load tenants", e);
      }
    })();
  }, []);

  // Загрузка dialogs для выбранного tenant
  React.useEffect(() => {
    if (!selectedTenant) return;
    (async () => {
      try {
        const res = await fetch(
          `/debug/dialogs?tenant_id=${encodeURIComponent(selectedTenant)}`,
        );
        const data = await res.json();
        const ds: DialogSummary[] = data.dialogs ?? [];
        setDialogs(ds);
        if (ds.length > 0 && !selectedChatId) {
          setSelectedChatId(ds[0].chat_id);
        }
      } catch (e) {
        console.error("Failed to load dialogs", e);
      }
    })();
  }, [selectedTenant]);

  // Загрузка событий для выбранного диалога
  React.useEffect(() => {
    if (!selectedTenant || !selectedChatId) return;
    (async () => {
      try {
        const res = await fetch(
          `/debug/dialog/${encodeURIComponent(selectedChatId)}?tenant_id=${encodeURIComponent(
            selectedTenant,
          )}`,
        );
        const data = await res.json();
        setEvents(data.events ?? []);
        // Build facts-per-event map
        if (data.facts) {
          const fmap = new Map<number, any[]>();
          for (const f of data.facts) {
            const eid = f.event_id;
            if (!fmap.has(eid)) fmap.set(eid, []);
            fmap.get(eid)!.push(f);
          }
          setFactsPerEvent(fmap);
        }
      } catch (e) {
        console.error("Failed to load dialog events", e);
      }
    })();
  }, [selectedTenant, selectedChatId, lastSend]);

  // Auto-scroll chat on new messages
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Monitor pending confirmations and set up reminders/escalations
  React.useEffect(() => {
    if (!schedule || !schedule.slots) return;

    // Clear existing timers
    for (const timeout of reminders.values()) clearTimeout(timeout);
    for (const timeout of escalations.values()) clearTimeout(timeout);
    setReminders(new Map());
    setEscalations(new Map());

    // Find users with pending slots
    const pendingByUser = new Map<string, number>();
    for (const slot of schedule.slots) {
      if (slot.user_id && slot.status === "PENDING") {
        pendingByUser.set(slot.user_id, (pendingByUser.get(slot.user_id) || 0) + 1);
      }
    }

    setPendingUsers(new Set(pendingByUser.keys()));

    // Автоматически закрываем задачи UNCONFIRMED для пользователей, которые подтвердили
    // И создаём задачи GAP для незаполненных слотов
    setActiveTasks((prev) => {
      const next = new Map(prev);
      
      // Закрываем UNCONFIRMED задачи для подтвердивших пользователей
      for (const [taskId, task] of prev.entries()) {
        if (taskId.startsWith("UNCONFIRMED:") && task.status === "OPEN") {
          const parts = taskId.split(":");
          const taskWeekStart = parts[1];
          const taskUserId = parts[2];
          // Если пользователь больше не в pending или неделя изменилась - закрываем задачу
          if (taskWeekStart !== weekStartISO || !pendingByUser.has(taskUserId)) {
            next.set(taskId, { ...task, status: "RESOLVED" });
          }
        }
      }
      
      // Создаём/обновляем задачи GAP для незаполненных слотов
      const emptySlots = (schedule.slots || []).filter((s: any) => s.status === "EMPTY");
      const now = Date.now();
      for (const slot of emptySlots) {
        const taskId = `GAP:${weekStartISO}:${slot.dow}:${slot.from}:${slot.to}`;
        const existing = next.get(taskId);
        if (!existing || existing.status === "RESOLVED") {
          // Создаём новую задачу
          next.set(taskId, {
            id: taskId,
            title: `Незаполненная смена: ${slot.slot_name} ${slot.dow} ${slot.from}-${slot.to}`,
            severity: "error",
            createdAt: now,
            updatedAt: now,
            status: "OPEN",
            counter: 1,
            nextReminderAt: now + 60000,
          });
        } else if (existing.status === "OPEN") {
          // Обновляем существующую (с кулдауном)
          const timeSinceLastUpdate = now - existing.updatedAt;
          if (timeSinceLastUpdate >= 60000) {
            next.set(taskId, {
              ...existing,
              counter: existing.counter + 1,
              updatedAt: now,
              nextReminderAt: now + 60000,
            });
          }
        }
      }
      
      // Закрываем GAP задачи для заполненных слотов
      for (const [taskId, task] of prev.entries()) {
        if (taskId.startsWith("GAP:") && task.status === "OPEN") {
          const parts = taskId.split(":");
          const taskWeekStart = parts[1];
          const taskDow = parts[2];
          const taskFrom = parts[3];
          const taskTo = parts[4];
          // Проверяем, заполнен ли этот слот
          const isFilled = (schedule.slots || []).some(
            (s: any) =>
              s.dow === taskDow &&
              s.from === taskFrom &&
              s.to === taskTo &&
              s.status !== "EMPTY"
          );
          if (taskWeekStart !== weekStartISO || isFilled) {
            next.set(taskId, { ...task, status: "RESOLVED" });
          }
        }
      }
      
      return next;
    });

    // Set up reminders (T1 = 30 seconds) and escalations (T2 = 60 seconds)
    for (const [userId, count] of pendingByUser.entries()) {
      const reminderId = `reminder_${userId}`;
      const escalationId = `escalation_${userId}`;

      // T1: Reminder after 30 seconds (только логируем, не блокируем)
      const reminderTimeout = setTimeout(() => {
        console.log(`[REMINDER] ${userId} не подтвердил график (${count} смен)`);
        // Не показываем alert, только логируем
      }, 30000); // 30 seconds

      // T2: Escalation after 60 seconds (создаём задачу вместо alert)
      const escalationTimeout = setTimeout(() => {
        console.log(`[ESCALATION] ${userId} не подтвердил график`);
        // Создаём/обновляем задачу вместо блокирующего alert
        const taskId = `UNCONFIRMED:${weekStartISO}:${userId}`;
        const now = Date.now();
        setActiveTasks((prev) => {
          const next = new Map(prev);
          const existing = next.get(taskId);
          if (existing && existing.status === "OPEN") {
            // Обновляем существующую задачу (дедупликация)
            const timeSinceLastUpdate = now - existing.updatedAt;
            if (timeSinceLastUpdate >= 60000) {
              // Кулдаун: обновляем только если прошло >= 60 секунд
              next.set(taskId, {
                ...existing,
                counter: existing.counter + 1,
                updatedAt: now,
                nextReminderAt: now + 60000, // следующий кулдаун через 60 секунд
              });
            } else {
              // В пределах кулдауна - только логируем, не обновляем UI
              console.log(`[ESCALATION] Task ${taskId} skipped (cooldown: ${Math.ceil((60000 - timeSinceLastUpdate) / 1000)}s remaining)`);
            }
          } else {
            // Создаём новую задачу
            next.set(taskId, {
              id: taskId,
              title: `${userId} не подтвердил график`,
              severity: "warning",
              createdAt: now,
              updatedAt: now,
              status: "OPEN",
              counter: 1,
              nextReminderAt: now + 60000,
            });
          }
          return next;
        });
      }, 60000); // 60 seconds

      setReminders((prev) => {
        const next = new Map(prev);
        next.set(reminderId, reminderTimeout);
        return next;
      });
      setEscalations((prev) => {
        const next = new Map(prev);
        next.set(escalationId, escalationTimeout);
        return next;
      });
    }

    // Cleanup on unmount
    return () => {
      for (const timeout of reminders.values()) clearTimeout(timeout);
      for (const timeout of escalations.values()) clearTimeout(timeout);
    };
  }, [schedule, weekStartISO]);

  // Helper: load dialog events
  const loadDialogEvents = async (chatId: string, tenantId: string) => {
    try {
      const res = await fetch(
        `/debug/dialog/${encodeURIComponent(chatId)}?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const data = await res.json();
      setEvents(data.events ?? []);
      if (data.facts) {
        const fmap = new Map<number, any[]>();
        for (const f of data.facts) {
          const eid = f.event_id;
          if (!fmap.has(eid)) fmap.set(eid, []);
          fmap.get(eid)!.push(f);
        }
        setFactsPerEvent(fmap);
      }
    } catch (e) {
      console.error("Failed to load dialog events", e);
      setLastError(`Failed to load events: ${String(e)}`);
    }
  };

  // Current user_id based on sender role
  const currentUserId =
    senderRole === "senior" ? "senior1"
    : senderRole === "owner" ? "owner1"
    : senderRole === "admin" ? "admin1"
    : "u1";

  // Helper: refresh week state
  const refreshWeekState = async () => {
    try {
      setWeekStateErr("");
      if (!selectedChatId) {
        setWeekStateErr("no chat selected");
        return;
      }

      const weekStart = weekStartISO || "2026-02-09";
      const url = `/debug/week_state?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStart)}`;

      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        setWeekStateErr(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        setWeekStateResp(null);
        return;
      }

      const json = JSON.parse(text);
      setWeekStateResp(json);
    } catch (e: any) {
      setWeekStateErr(String(e?.message || e));
      setWeekStateResp(null);
    }
  };

  // Helper: send debug message
  const debugSend = async (
    text: string,
    roleOverride?: "staff" | "senior" | "owner" | "admin",
  ) => {
    if (!selectedTenant || !selectedChatId) return;
    const role = roleOverride ?? senderRole;
    const user_id =
      role === "senior"
        ? "senior1"
        : role === "owner"
          ? "owner1"
          : role === "admin"
            ? "admin1"
            : "u1";

    try {
      const res = await fetch("/debug/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: selectedTenant,
          chat_id: selectedChatId,
          user_id,
          text,
          meta: { role },
        }),
      });

      const responseText = await res.text();

      if (!res.ok) {
        setLastError(`HTTP ${res.status}: ${responseText.slice(0, 200)}`);
        return null;
      }

      let json: any;
      try {
        json = JSON.parse(responseText);
      } catch {
        setLastError(`Ответ не JSON: ${responseText.slice(0, 100)}`);
        return null;
      }

      if (json.ok) {
        setLastSend({
          event: json.event,
          facts: json.facts ?? [],
          facts_count: json.facts_count ?? 0,
        });
        setLastError(null);
      } else {
        setLastError(`Send failed: ${json.error || "unknown error"}`);
      }

      // Refresh chat and week state
      await loadDialogEvents(selectedChatId, selectedTenant);
      await refreshWeekState();
      return json;
    } catch (e) {
      console.error("Failed to send debug message", e);
      setLastError(`Ошибка отправки: ${String(e)}. Проверьте что бэкенд запущен (node backend/server.js)`);
    }
  };

  const loadTimesheet = async () => {
    try {
      setTimesheetErr("");
      if (!selectedChatId) {
        setTimesheetErr("no chat selected");
        return;
      }

      const weekStart = weekStartISO || "2026-02-09";
      const url = `/debug/timesheet?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStart)}`;

      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        setTimesheetErr(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        setTimesheet(null);
        return;
      }

      const json = JSON.parse(text);
      setTimesheet(json.timesheet);
    } catch (e: any) {
      setTimesheetErr(String(e?.message || e));
      setTimesheet(null);
    }
  };

  return (
    <div className="app-root">
      {backendOk === false && (
        <div className="empty" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          Backend /health не отвечает
        </div>
      )}
      {/* Левая колонка: Tenants + Dialogs */}
      <aside className="pane pane-left">
        <div className="pane-header">
          <h2>Тенанты</h2>
          <div style={{ display: "flex", gap: "4px" }}>
            <select
              value={selectedTenant ?? ""}
              onChange={(e) => setSelectedTenant(e.target.value || null)}
            >
              {tenants.map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.tenant_id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const newTenant = prompt("Введите имя нового tenant:");
                if (newTenant && newTenant.trim()) {
                  setSelectedTenant(newTenant.trim());
                }
              }}
            >
              + Tenant
            </button>
          </div>
        </div>
        <div className="pane-content">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <h3 style={{ margin: 0 }}>Диалоги</h3>
            <button
              type="button"
              onClick={() => {
                const newId = `chat_${Date.now().toString(36)}`;
                setSelectedChatId(newId);
                setEvents([]);
                setDialogs((prev) => [{ chat_id: newId }, ...prev]);
              }}
              style={{ fontSize: "0.8em", padding: "2px 8px" }}
            >
              + Чат
            </button>
          </div>
          {dialogs.length === 0 && <div className="empty">Нет диалогов</div>}
          <ul className="dialog-list">
            {dialogs.map((d) => (
              <li
                key={d.chat_id}
                className={
                  d.chat_id === selectedChatId ? "dialog-item selected" : "dialog-item"
                }
                onClick={() => setSelectedChatId(d.chat_id)}
              >
                <div className="dialog-title">{d.chat_id}</div>
                <div className="dialog-meta">
                  <span>{(d.last_text ?? "").length > 50 ? (d.last_text!.slice(0, 50) + "...") : (d.last_text ?? "")}</span>
                  {d.last_ts && <span>{new Date(d.last_ts).toLocaleString("ru-RU")}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Центр: Chat window */}
      <main className="pane pane-center">
        <div className="pane-header">
          <h2>Чат</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label>
              Роль:
              <select
                value={senderRole}
                onChange={(e) => setSenderRole(e.target.value)}
                style={{ marginLeft: "4px" }}
              >
                <option value="staff">staff</option>
                <option value="senior">senior</option>
                <option value="owner">owner</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button
              type="button"
              onClick={async () => {
                if (!selectedTenant || !selectedChatId) {
                  alert("Выберите tenant и chat");
                  return;
                }
                const messages = [
                  "могу пн утро",
                  "могу вт утро",
                  "могу чт вечер",
                ];
                for (const msg of messages) {
                  try {
                    const res = await fetch("/debug/send", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        tenant_id: selectedTenant,
                        chat_id: selectedChatId,
                        user_id: "u1",
                        text: msg,
                        meta: { role: senderRole },
                      }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setLastSend({
                        event: data.event,
                        facts: data.facts ?? [],
                        facts_count: data.facts_count ?? 0,
                      });
                    }
                    await new Promise((resolve) => setTimeout(resolve, 200));
                  } catch (err) {
                    console.error("Failed to send scenario message", err);
                  }
                }
                // Refresh events
                try {
                  const res = await fetch(
                    `/debug/dialog/${encodeURIComponent(selectedChatId)}?tenant_id=${encodeURIComponent(
                      selectedTenant,
                    )}`,
                  );
                  const data = await res.json();
                  setEvents(data.events ?? []);
                } catch (e) {
                  console.error("Failed to refresh events", e);
                }
              }}
            >
              Обычная неделя
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!selectedTenant || !selectedChatId) {
                  alert("Выберите tenant и chat");
                  return;
                }
                // Calculate weekStart for the scenario
                const today = new Date();
                const dayOfWeek = today.getDay();
                const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                const monday = new Date(today);
                monday.setDate(today.getDate() + diff);
                const weekStart = monday.toISOString().split("T")[0];

                // Step 1: Declare GAP
                await fetch("/debug/send", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    tenant_id: selectedTenant,
                    chat_id: selectedChatId,
                    user_id: "u1",
                    text: `DECLARE_GAP ${weekStart} thu 18-21`,
                    meta: { role: "staff" },
                  }),
                });
                await new Promise((resolve) => setTimeout(resolve, 300));

                // Step 2: Senior assigns
                await fetch("/debug/send", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    tenant_id: selectedTenant,
                    chat_id: selectedChatId,
                    user_id: "senior1",
                    text: `ASSIGN ${weekStart} thu 18-21 u2`,
                    meta: { role: "senior" },
                  }),
                });
                await new Promise((resolve) => setTimeout(resolve, 300));

                // Step 3: Owner approves overtime
                await fetch("/debug/send", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    tenant_id: selectedTenant,
                    chat_id: selectedChatId,
                    user_id: "owner1",
                    text: `APPROVE_OVERTIME ${weekStart} thu 18-21`,
                    meta: { role: "owner" },
                  }),
                });
                await new Promise((resolve) => setTimeout(resolve, 300));

                // Step 4: Lock
                await fetch("/debug/send", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    tenant_id: selectedTenant,
                    chat_id: selectedChatId,
                    user_id: "owner1",
                    text: `LOCK ${weekStart}`,
                    meta: { role: "owner" },
                  }),
                });
                await new Promise((resolve) => setTimeout(resolve, 300));

                // Refresh events
                try {
                  const res = await fetch(
                    `/debug/dialog/${encodeURIComponent(selectedChatId)}?tenant_id=${encodeURIComponent(
                      selectedTenant,
                    )}`,
                  );
                  const data = await res.json();
                  setEvents(data.events ?? []);
                } catch (e) {
                  console.error("Failed to refresh events", e);
                }
              }}
            >
              Запустить сценарий: замена смены
            </button>
          </div>
        </div>
        <div className="pane-content chat-content">
          {/* Верхнее окно: Chat messages */}
          <div className="chat-window-top">
            <div className="chat-messages">
              {events.length === 0 ? (
                <div className="empty" style={{ alignSelf: "center", marginTop: "2rem" }}>
                  Выберите диалог или отправьте первое сообщение.
                </div>
              ) : (
                events.map((ev) => {
                  const isSelf = ev.user_id === currentUserId;
                  const evFacts = factsPerEvent.get(ev.id);
                  const ts = ev.received_at ? new Date(ev.received_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
                  return (
                    <div key={ev.id} className={`chat-bubble ${isSelf ? "self" : "other"}`}>
                      <div className="bubble-header">
                        <span>{UserDirectory.getDisplayName(ev.user_id)} ({ev.user_id})</span>
                        <span>{ts}{evFacts && evFacts.length > 0 ? (evFacts.some((f: any) => f.fact_type === "SHIFT_REPLACEMENT") ? " 🔄" : " ✅") : ""}</span>
                      </div>
                      <div className="bubble-text">{ev.text}</div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              className="chat-input"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!inputText.trim()) return;
                const text = inputText.trim();
                setInputText("");
                await debugSend(text);
              }}
            >
              <input
                type="text"
                placeholder="Введите сообщение..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              <button type="submit" disabled={!inputText.trim() || !selectedTenant || !selectedChatId}>
                Отправить
              </button>
            </form>
          </div>
          
          {/* Нижнее окно: Сотрудники и Табель */}
          <div className="chat-window-bottom">
            <div style={{ padding: "8px", borderBottom: "1px solid #ddd" }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: "0.9rem" }}>Сотрудники</h3>
              <div style={{ fontSize: "0.8em" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75em" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #ddd" }}>
                      <th style={{ textAlign: "left", padding: "2px 4px" }}>Имя</th>
                      <th style={{ textAlign: "left", padding: "2px 4px" }}>Роль</th>
                      <th style={{ textAlign: "right", padding: "2px 4px" }}>Ставка/час</th>
                      <th style={{ textAlign: "right", padding: "2px 4px" }}>Мин. часов/нед</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { id: "isa", name: "Иса", role: "junior", rate: 280, minHours: 22 },
                      { id: "daria", name: "Дарина", role: "junior", rate: 280, minHours: 20 },
                      { id: "ksu", name: "Ксюша", role: "junior", rate: 280, minHours: 0 },
                      { id: "karina", name: "Карина", role: "junior", rate: 280, minHours: 20 },
                    ].map((emp) => (
                      <tr key={emp.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "2px 4px" }}>{emp.name}</td>
                        <td style={{ padding: "2px 4px" }}>{emp.role}</td>
                        <td style={{ textAlign: "right", padding: "2px 4px" }}>{emp.rate} ₽</td>
                        <td style={{ textAlign: "right", padding: "2px 4px" }}>
                          {emp.minHours > 0 ? `${emp.minHours} ч` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ padding: "8px", flex: 1, overflow: "auto" }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: "0.9rem" }}>Табель расчета зарплаты</h3>
              {timesheet ? (
                <div style={{ fontSize: "0.8em" }}>
                  <div style={{ marginBottom: "8px", fontWeight: "bold" }}>
                    Неделя: {timesheet.week_start}
                  </div>
                  {timesheet.totals && (
                    <div style={{ marginBottom: "8px", padding: "4px", backgroundColor: "#f0f0f0", borderRadius: "4px" }}>
                      <strong>Итого:</strong> {fmtNum(timesheet.totals.total_hours)} ч, {fmtRub(timesheet.totals.total_pay)}
                    </div>
                  )}
                  {timesheet.employees && timesheet.employees.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.7em" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #ccc" }}>
                          <th style={{ textAlign: "left", padding: "2px 3px" }}>Имя</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Часы</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Пробл.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Вычет</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Эфф.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Ставка</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Смены</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уб.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уб. ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Доп ч.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Доп ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Итого</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timesheet.employees.map((emp: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "2px 3px" }}>{emp.name || emp.user_id}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.shift_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px", color: emp.problem_shifts > 0 ? "#dc3545" : undefined }}>{emp.problem_shifts}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px", color: emp.problem_deduction_hours > 0 ? "#dc3545" : undefined }}>{emp.problem_deduction_hours > 0 ? `-${emp.problem_deduction_hours}` : "0"}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.effective_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.rate}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.shift_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.cleaning_count}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.cleaning_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.extra_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.extra_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px", fontWeight: "bold" }}>{fmtRub(emp.total_pay)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty">Нет данных. Нажмите "Показать табель" в Debug панели.</div>
                  )}
                </div>
              ) : (
                <div className="empty">Табель не загружен. Нажмите "Показать табель" в Debug панели.</div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Правая колонка: Debug panel */}
      <aside className="pane pane-right">
        <div className="pane-header">
          <h2>Debug</h2>
          <div style={{ fontSize: 12, opacity: 0.6 }}>UI_BUILD: week-commands-v1</div>
        </div>
        <div className="pane-content debug-content">
          <section>
            <h3>Сотрудники для расчёта</h3>
            <div style={{ fontSize: "0.85em", marginBottom: "8px" }}>
              Выберите сотрудников, которые будут учитываться при сборке графика:
            </div>
            {UserDirectory.getAllUsers().map((user) => (
              <label
                key={user.id}
                style={{ display: "flex", alignItems: "center", marginBottom: "4px", fontSize: "0.85em" }}
              >
                <input
                  type="checkbox"
                  checked={selectedRosterUsers.has(user.id)}
                  onChange={(e) => {
                    const newSet = new Set(selectedRosterUsers);
                    if (e.target.checked) {
                      newSet.add(user.id);
                    } else {
                      newSet.delete(user.id);
                    }
                    setSelectedRosterUsers(newSet);
                    // Сохраняем в localStorage
                    localStorage.setItem("roster_selected_users", JSON.stringify(Array.from(newSet)));
                  }}
                  style={{ marginRight: "6px" }}
                />
                <span>
                  {user.displayName} ({user.id}) - {user.role} - {user.ratePerHour}₽/ч
                </span>
              </label>
            ))}
            <div style={{ fontSize: "0.75em", color: "#666", marginTop: "8px" }}>
              Выбрано: {selectedRosterUsers.size} из {UserDirectory.getAllUsers().length}
            </div>
          </section>
          <section>
            <h3>Требуются действия ({Array.from(activeTasks.values()).filter((t) => t.status === "OPEN").length})</h3>
            {(() => {
              const openTasks = Array.from(activeTasks.values()).filter((t) => t.status === "OPEN");
              if (openTasks.length === 0) {
                return (
                  <div style={{ fontSize: "0.85em", color: "#28a745", marginTop: "8px" }}>
                    ✅ Нет активных задач
                  </div>
                );
              }
              return (
                <div style={{ marginTop: "8px" }}>
                  <details open>
                    <summary style={{ cursor: "pointer", fontSize: "0.85em", marginBottom: "4px", fontWeight: "bold" }}>
                      Список задач ({openTasks.length})
                    </summary>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                      {openTasks.map((task) => (
                        <div
                          key={task.id}
                          style={{
                            padding: "8px",
                            backgroundColor: task.severity === "error" ? "#f8d7da" : "#fff3cd",
                            border: `1px solid ${task.severity === "error" ? "#dc3545" : "#ffc107"}`,
                            borderRadius: "4px",
                            fontSize: "0.8em",
                          }}
                        >
                          <div style={{ fontWeight: "bold", marginBottom: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>{task.title}</span>
                            {task.id.startsWith("PROBLEM:") && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTasks((prev) => {
                                    const next = new Map(prev);
                                    const existing = next.get(task.id);
                                    if (existing) {
                                      next.set(task.id, { ...existing, status: "RESOLVED" });
                                    }
                                    return next;
                                  });
                                }}
                                style={{
                                  fontSize: "0.7em",
                                  padding: "2px 6px",
                                  backgroundColor: "#28a745",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "2px",
                                  cursor: "pointer",
                                }}
                                title="Закрыть задачу (для админа)"
                              >
                                ✓ Закрыть
                              </button>
                            )}
                          </div>
                          {task.id.startsWith("PROBLEM:") && (
                            <div style={{ fontSize: "0.75em", color: "#856404", marginBottom: "4px", fontWeight: "bold" }}>
                              Статус: {task.status === "OPEN" ? "⏳ Ожидает решения админом" : "✅ Решено"}
                            </div>
                          )}
                          {task.payload?.reason && (
                            <div style={{ fontSize: "0.75em", color: "#666", marginBottom: "2px" }}>
                              Тип проблемы: <strong>{task.payload.reason}</strong>
                            </div>
                          )}
                          {task.payload?.comment && (
                            <div style={{ fontSize: "0.75em", color: "#666", marginBottom: "2px", fontStyle: "italic" }}>
                              Комментарий: "{task.payload.comment}"
                            </div>
                          )}
                          <div style={{ fontSize: "0.75em", color: "#666", marginBottom: "4px" }}>
                            Создано: {new Date(task.createdAt).toLocaleString("ru-RU")}
                            {task.counter > 1 && ` (обновлено ${task.counter} раз)`}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              // Прокручиваем к соответствующему блоку
                              if (task.id.startsWith("UNCONFIRMED:")) {
                                const parts = task.id.split(":");
                                const taskUserId = parts[2];
                                const element = document.querySelector(`[data-user-confirm="${taskUserId}"]`);
                                if (element) {
                                  element.scrollIntoView({ behavior: "smooth", block: "center" });
                                  const originalBg = (element as HTMLElement).style.backgroundColor;
                                  (element as HTMLElement).style.backgroundColor = "#fff3cd";
                                  setTimeout(() => {
                                    (element as HTMLElement).style.backgroundColor = originalBg;
                                  }, 2000);
                                }
                              } else if (task.id.startsWith("PROBLEM:")) {
                                const parts = task.id.split(":");
                                const taskUserId = parts[2];
                                const element = document.querySelector(`[data-user-confirm="${taskUserId}"]`);
                                if (element) {
                                  element.scrollIntoView({ behavior: "smooth", block: "center" });
                                  const originalBg = (element as HTMLElement).style.backgroundColor;
                                  (element as HTMLElement).style.backgroundColor = "#fff3cd";
                                  setTimeout(() => {
                                    (element as HTMLElement).style.backgroundColor = originalBg;
                                  }, 2000);
                                }
                              } else if (task.id.startsWith("GAP:")) {
                                setActiveTab("empty");
                                setTimeout(() => {
                                  const element = document.querySelector('[data-tab="empty"]');
                                  if (element) {
                                    element.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }
                                }, 100);
                              }
                            }}
                            style={{
                              fontSize: "0.75em",
                              padding: "2px 6px",
                              backgroundColor: "transparent",
                              border: "1px solid #666",
                              borderRadius: "2px",
                              cursor: "pointer",
                            }}
                          >
                            Показать в графике
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              );
            })()}
          </section>
          <section>
            <h3>Статус бэкенда</h3>
            <div className="empty">
              {backendOk === null
                ? "проверка..."
                : backendOk
                  ? "ok"
                  : "не отвечает"}
            </div>
          </section>
          <section>
            <h3>Последнее событие</h3>
            <div className="empty">
              {lastSend?.event ? (
                <div style={{ fontSize: "0.85em" }}>
                  <div><strong>text:</strong> {lastSend.event.text}</div>
                  <div>id: {lastSend.event.id} | trace: {lastSend.event.trace_id?.slice(0, 8)}</div>
                  <div>received_at: {lastSend.event.received_at}</div>
                </div>
              ) : (
                "—"
              )}
            </div>
          </section>
          <section>
            <h3>Факты</h3>
            <div className="empty">
              Распознано: {lastSend?.facts_count ?? lastSend?.facts?.length ?? 0}
            </div>
            {lastSend?.facts && lastSend.facts.length > 0 ? (
              lastSend.facts.map((f) => (
                <div key={f.id} className="empty" style={{ fontSize: "0.85em" }}>
                  <div>
                    <strong>{f.fact_type}</strong>
                  </div>
                  <div>{JSON.stringify(f.fact_payload)}</div>
                </div>
              ))
            ) : (
              <div className="empty">facts: 0</div>
            )}
          </section>
          <section>
            <h3>Schedule v0</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "8px" }}>
              <button
                type="button"
                onClick={async () => {
                  if (!selectedTenant || !selectedChatId) {
                    alert("Выберите tenant и chat");
                    return;
                  }
                  // Calculate Monday of current week
                  const today = new Date();
                  const dayOfWeek = today.getDay();
                  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday = 1
                  const monday = new Date(today);
                  monday.setDate(today.getDate() + diff);
                  const weekStart = monday.toISOString().split("T")[0]; // YYYY-MM-DD

                  try {
                    const res = await fetch(
                      `/debug/schedule?tenant_id=${encodeURIComponent(
                        selectedTenant,
                      )}&chat_id=${encodeURIComponent(selectedChatId)}&week_start=${weekStart}`,
                    );
                    const data = await res.json();
                    setSchedule(data);
                  } catch (e) {
                    console.error("Failed to load schedule", e);
                    setSchedule(null);
                  }
                }}
              >
                Пересчитать график
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!selectedTenant || !selectedChatId) {
                    alert("Выберите tenant и chat");
                    return;
                  }

                  // Calculate Monday of current week
                  const today = new Date();
                  const dayOfWeek = today.getDay();
                  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                  const monday = new Date(today);
                  monday.setDate(today.getDate() + diff);
                  const weekStart = monday.toISOString().split("T")[0];

                  // Template: week slots with hours
                  const weekTemplate = [
                    { dow: "mon", morning: 5, evening: 6 },
                    { dow: "tue", morning: 5, evening: 6 },
                    { dow: "wed", morning: 4.5, evening: 6 },
                    { dow: "thu", morning: 5, evening: 5.5 },
                    { dow: "fri", morning: 5.5, evening: 6.5 },
                    { dow: "sat", morning: 6, evening: 6.5 },
                    { dow: "sun", morning: 5, evening: 6 },
                  ];

                  // Step 1: Open week
                  await debugSend(`OPEN_WEEK ${weekStart}`, "admin");
                  await new Promise((resolve) => setTimeout(resolve, 200));

                  // Helper function to send availability with specific user_id
                  const sendAvailability = async (user_id: string, role: string, dow: string, timeRange: string) => {
                    try {
                      const res = await fetch("/debug/send", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          tenant_id: selectedTenant,
                          chat_id: selectedChatId,
                          user_id,
                          text: `AVAIL ${dow} ${timeRange}`,
                          meta: { role },
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setLastSend({
                          event: data.event,
                          facts: data.facts ?? [],
                          facts_count: data.facts_count ?? 0,
                        });
                      }
                    } catch (err) {
                      console.error("Failed to send availability", err);
                    }
                  };

                  // Step 2: Send availability for Иса (isa) - младший, минимум 22 часа
                  const isaAvailability = [
                    { dow: "mon", slot: "morning" },
                    { dow: "tue", slot: "morning" },
                    { dow: "thu", slot: "morning" },
                    { dow: "fri", slot: "morning" },
                    { dow: "sat", slot: "morning" },
                  ];
                  for (const avail of isaAvailability) {
                    const timeRange = avail.slot === "morning" ? "10-13" : "18-21";
                    await sendAvailability("isa", "staff", avail.dow, timeRange);
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  }

                  // Step 3: Send availability for Дарина (daria) - младший, минимум 20 часов
                  const dariaAvailability = [
                    { dow: "mon", slot: "evening" },
                    { dow: "tue", slot: "evening" },
                    { dow: "wed", slot: "morning" },
                    { dow: "thu", slot: "morning" },
                    { dow: "sat", slot: "morning" },
                    { dow: "sun", slot: "evening" },
                  ];
                  for (const avail of dariaAvailability) {
                    const timeRange = avail.slot === "morning" ? "10-13" : "18-21";
                    await sendAvailability("daria", "staff", avail.dow, timeRange);
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  }

                  // Step 4: Send availability for Ксюша (ksu) - младший, без минимума
                  const ksuAvailability = [
                    { dow: "tue", slot: "morning" },
                    { dow: "tue", slot: "evening" },
                    { dow: "wed", slot: "evening" },
                    { dow: "thu", slot: "evening" },
                    { dow: "fri", slot: "evening" },
                    { dow: "sun", slot: "morning" },
                  ];
                  for (const avail of ksuAvailability) {
                    const timeRange = avail.slot === "morning" ? "10-13" : "18-21";
                    await sendAvailability("ksu", "staff", avail.dow, timeRange);
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  }

                  // Step 5: Send availability for Карина (karina) - junior, min 20h, все слоты
                  for (const day of weekTemplate) {
                    await sendAvailability("karina", "staff", day.dow, "10-13");
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    await sendAvailability("karina", "staff", day.dow, "18-21");
                    await new Promise((resolve) => setTimeout(resolve, 100));
                  }

                  // Refresh events and schedule
                  await loadDialogEvents(selectedChatId, selectedTenant);
                  await refreshWeekState();
                  
                  alert("Эталонная неделя v1 загружена! Теперь можно нажать 'Собрать график (черновик)'");
                }}
                style={{ backgroundColor: "#e7f3ff", borderColor: "#0066cc" }}
              >
                Загрузить эталонную неделю v1
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "8px", borderBottom: "1px solid #ddd" }}>
              <button
                type="button"
                onClick={() => setActiveTab("schedule")}
                style={{
                  padding: "4px 8px",
                  border: "none",
                  backgroundColor: activeTab === "schedule" ? "#007bff" : "transparent",
                  color: activeTab === "schedule" ? "white" : "#666",
                  cursor: "pointer",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                График
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("timesheet")}
                style={{
                  padding: "4px 8px",
                  border: "none",
                  backgroundColor: activeTab === "timesheet" ? "#007bff" : "transparent",
                  color: activeTab === "timesheet" ? "white" : "#666",
                  cursor: "pointer",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                Табель
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("empty")}
                style={{
                  padding: "4px 8px",
                  border: "none",
                  backgroundColor: activeTab === "empty" ? "#007bff" : "transparent",
                  color: activeTab === "empty" ? "white" : "#666",
                  cursor: "pointer",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                Незаполненные
              </button>
            </div>

            {/* Tab Content: Schedule */}
            {activeTab === "schedule" && (
              <>
                {schedule && (
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "0.85em", marginBottom: "8px" }}>
                      Неделя: {schedule.week_start}
                    </div>
                    
                    {/* Schedule Grid 7×2 */}
                    {schedule.slots && (
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ fontSize: "0.85em", marginBottom: "8px", fontWeight: "bold" }}>
                      Живой график:
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "80px repeat(7, 1fr)",
                        gap: "4px",
                        fontSize: "0.75em",
                      }}
                    >
                      {/* Header row */}
                      <div style={{ fontWeight: "bold", padding: "4px" }}>Слот</div>
                      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, i) => (
                        <div key={i} style={{ fontWeight: "bold", padding: "4px", textAlign: "center" }}>
                          {day}
                        </div>
                      ))}
                      
                      {/* Morning slots */}
                      <div style={{ padding: "4px", fontWeight: "bold" }}>Утро</div>
                      {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((dow) => {
                        const slot = (schedule.slots || []).find(
                          (s: any) => s.dow === dow && s.slot_name === "Утро"
                        );
                        const bgColor =
                          slot?.status === "CONFIRMED"
                            ? "#d4edda"
                            : slot?.status === "PENDING"
                              ? "#fff3cd"
                              : slot?.status === "PROBLEM"
                                ? "#f8d7da"
                                : "#f8d7da";
                        const borderColor =
                          slot?.status === "CONFIRMED"
                            ? "#28a745"
                            : slot?.status === "PENDING"
                              ? "#ffc107"
                              : slot?.status === "PROBLEM"
                                ? "#dc3545"
                                : "#dc3545";
                        return (
                          <div
                            key={`${dow}-morning`}
                            style={{
                              padding: "6px",
                              backgroundColor: bgColor,
                              border: `2px solid ${borderColor}`,
                              borderRadius: "4px",
                              minHeight: "50px",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "center",
                            }}
                          >
                            {slot?.user_id ? (
                              <>
                                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                                  {slot.replaced_user_id
                                    ? `${UserDirectory.getDisplayName(slot.user_id)} (за ${UserDirectory.getDisplayName(slot.replaced_user_id)})`
                                    : UserDirectory.getDisplayName(slot.user_id)}
                                </div>
                                <div style={{ fontSize: "0.85em", color: "#666" }}>
                                  {slot.hours != null ? `${slot.hours.toFixed(1)} ч` : "—"}
                                  {slot.replaced_user_id && " 🔄"}
                                  {slot.is_problem && " ⚠️"}
                                </div>
                              </>
                            ) : (
                              <div style={{ color: "#999", fontStyle: "italic" }}>Свободно</div>
                            )}
                          </div>
                        );
                      })}

                      {/* Evening slots */}
                      <div style={{ padding: "4px", fontWeight: "bold" }}>Вечер</div>
                      {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((dow) => {
                        const slot = (schedule.slots || []).find(
                          (s: any) => s.dow === dow && s.slot_name === "Вечер"
                        );
                        const bgColor =
                          slot?.status === "CONFIRMED"
                            ? "#d4edda"
                            : slot?.status === "PENDING"
                              ? "#fff3cd"
                              : slot?.status === "PROBLEM"
                                ? "#f8d7da"
                                : "#f8d7da";
                        const borderColor =
                          slot?.status === "CONFIRMED"
                            ? "#28a745"
                            : slot?.status === "PENDING"
                              ? "#ffc107"
                              : slot?.status === "PROBLEM"
                                ? "#dc3545"
                                : "#dc3545";
                        return (
                          <div
                            key={`${dow}-evening`}
                            style={{
                              padding: "6px",
                              backgroundColor: bgColor,
                              border: `2px solid ${borderColor}`,
                              borderRadius: "4px",
                              minHeight: "50px",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "center",
                            }}
                          >
                            {slot?.user_id ? (
                              <>
                                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                                  {slot.replaced_user_id
                                    ? `${UserDirectory.getDisplayName(slot.user_id)} (за ${UserDirectory.getDisplayName(slot.replaced_user_id)})`
                                    : UserDirectory.getDisplayName(slot.user_id)}
                                </div>
                                <div style={{ fontSize: "0.85em", color: "#666" }}>
                                  {slot.hours != null ? `${slot.hours.toFixed(1)} ч` : "—"}
                                  {slot.replaced_user_id && " 🔄"}
                                  {slot.is_problem && " ⚠️"}
                                </div>
                              </>
                            ) : (
                              <div style={{ color: "#999", fontStyle: "italic" }}>Свободно</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                    {!schedule || !schedule.slots ? (
                      <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                        График не загружен. Нажмите "Пересчитать график" или "Собрать график (черновик)".
                      </div>
                    ) : null}

                    {/* Legacy text view (collapsed by default) */}
                    <details style={{ fontSize: "0.85em", marginTop: "8px" }}>
                      <summary style={{ cursor: "pointer", marginBottom: "4px" }}>
                        Детали (назначения, пробелы, конфликты)
                      </summary>
                      <div style={{ fontSize: "0.85em", marginBottom: "4px" }}>
                        <strong>Назначенные смены ({schedule.assignments?.length ?? 0}):</strong>
                      </div>
                      {schedule.assignments && schedule.assignments.length > 0 ? (
                        schedule.assignments.map((a, i) => (
                          <div key={i} className="empty" style={{ fontSize: "0.8em" }}>
                            {a.dow} {a.from}-{a.to}: {a.user_id} ({a.reason === "manual assignment" ? "ручное назначение" : a.reason})
                          </div>
                        ))
                      ) : (
                        <div className="empty" style={{ fontSize: "0.8em" }}>
                          Нет назначений
                        </div>
                      )}
                      <div style={{ fontSize: "0.85em", marginTop: "8px", marginBottom: "4px" }}>
                        <strong>Незакрытые смены ({schedule.gaps?.length ?? 0}):</strong>
                      </div>
                      {schedule.gaps && schedule.gaps.length > 0 ? (
                        schedule.gaps.map((g, i) => (
                          <div key={i} className="empty" style={{ fontSize: "0.8em" }}>
                            {g.dow} {g.from}-{g.to}: {g.reason}
                          </div>
                        ))
                      ) : (
                        <div className="empty" style={{ fontSize: "0.8em" }}>
                          Нет незакрытых смен
                        </div>
                      )}
                      <div style={{ fontSize: "0.85em", marginTop: "8px", marginBottom: "4px" }}>
                        <strong>Конфликты ({schedule.conflicts?.length ?? 0}):</strong>
                      </div>
                      {schedule.conflicts && schedule.conflicts.length > 0 ? (
                        schedule.conflicts.map((c, i) => (
                          <div key={i} className="empty" style={{ fontSize: "0.8em" }}>
                            {c.dow} {c.from}-{c.to}: {c.reason}
                          </div>
                        ))
                      ) : (
                        <div className="empty" style={{ fontSize: "0.8em" }}>
                          Нет конфликтов
                        </div>
                      )}
                    </details>
                  </div>
                )}
                {!schedule && (
                  <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                    График не загружен. Нажмите "Пересчитать график" или "Собрать график (черновик)".
                  </div>
                )}
              </>
            )}

            {/* Tab Content: Timesheet */}
            {activeTab === "timesheet" && (
              <>
                <div style={{ marginBottom: "8px" }}>
                  <button type="button" onClick={loadTimesheet}>
                    Пересчитать табель
                  </button>
                </div>
                {timesheetErr && (
                  <div style={{ marginTop: "8px", fontSize: "0.8em", color: "red" }}>
                    Ошибка: {timesheetErr}
                  </div>
                )}
                {timesheet && (
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "0.85em", marginBottom: "8px" }}>
                      <strong>Итого:</strong> {fmtNum(timesheet.totals?.total_hours)} ч, {fmtRub(timesheet.totals?.total_pay)}
                    </div>
                    <table
                      style={{
                        fontSize: "0.75em",
                        borderCollapse: "collapse",
                        width: "100%",
                        marginTop: "4px",
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: "1px solid #ccc" }}>
                          <th style={{ textAlign: "left", padding: "2px 3px" }}>Имя</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Часы</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Пробл.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Вычет</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Эфф.часы</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Ставка</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Смены ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уборки</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уборки ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Допы ч.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Допы ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Итого ₽</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timesheet.employees?.map((emp: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "2px 3px" }}>{emp.name || emp.user_id}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.shift_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px", color: emp.problem_shifts > 0 ? "#dc3545" : undefined }}>{emp.problem_shifts}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px", color: emp.problem_deduction_hours > 0 ? "#dc3545" : undefined }}>{emp.problem_deduction_hours > 0 ? `-${emp.problem_deduction_hours}` : "0"}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.effective_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.rate}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.shift_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.cleaning_count}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.cleaning_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.extra_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.extra_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px", fontWeight: "bold" }}>{fmtRub(emp.total_pay)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "0.85em", marginBottom: "4px" }}>
                        <strong>Команды табеля:</strong>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => debugSend(`WORKED ${weekStartISO} mon 10-13`, "staff")}
                        >
                          Отметить работу (пн 10-13)
                        </button>
                        <button
                          type="button"
                          onClick={() => debugSend(`WORKED ${weekStartISO} thu 18-21`, "staff")}
                        >
                          Отметить работу (чт 18-21)
                        </button>
                        <button
                          type="button"
                          onClick={() => debugSend(`CONFIRM_TIMESHEET ${weekStartISO}`, "admin")}
                        >
                          Подтвердить табель
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Tab Content: Empty Slots */}
            {activeTab === "empty" && (
              <>
                <div data-tab="empty"></div>
                {schedule && schedule.slots ? (
                  (() => {
                    const emptySlots = schedule.slots.filter((s: any) => s.status === "EMPTY");
                    const DOW_NAMES: Record<string, string> = {
                      mon: "Понедельник",
                      tue: "Вторник",
                      wed: "Среда",
                      thu: "Четверг",
                      fri: "Пятница",
                      sat: "Суббота",
                      sun: "Воскресенье",
                    };
                    return (
                      <div style={{ marginTop: "8px" }}>
                        {emptySlots.length === 0 ? (
                          <div style={{ fontSize: "0.85em", color: "#28a745" }}>
                            ✅ Все смены заполнены
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: "0.85em", marginBottom: "8px", color: "#666" }}>
                              Найдено незаполненных смен: {emptySlots.length}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {emptySlots.map((slot: any, idx: number) => (
                                <div
                                  key={idx}
                                  style={{
                                    padding: "8px",
                                    backgroundColor: "#f8d7da",
                                    border: "1px solid #dc3545",
                                    borderRadius: "4px",
                                    fontSize: "0.85em",
                                  }}
                                >
                                  <div style={{ fontWeight: "bold" }}>
                                    {DOW_NAMES[slot.dow] || slot.dow} · {slot.slot_name}
                                  </div>
                                  <div style={{ color: "#666", marginTop: "2px" }}>
                                    {slot.from} - {slot.to}
                                    {slot.hours != null ? ` (${slot.hours.toFixed(1)} ч)` : " (—)"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                    График не загружен. Нажмите "Пересчитать график" или "Собрать график (черновик)".
                  </div>
                )}
              </>
            )}

            {lastError && (
              <div style={{ marginTop: "8px", fontSize: "0.8em", color: "red" }}>
                Error: {lastError}
              </div>
            )}
          </section>
          <section>
            <h3>Управление графиком</h3>
            <div style={{ marginBottom: "8px" }}>
              <input
                type="text"
                placeholder="2026-02-09"
                value={weekStartISO}
                onChange={(e) => setWeekStartISO(e.target.value)}
                style={{ width: "100%", fontSize: "0.8em", padding: "2px" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "8px" }}>
              <button type="button" onClick={() => debugSend(`OPEN_WEEK ${weekStartISO}`)}>
                Начать сбор доступности
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!selectedChatId) {
                    alert("Выберите chat");
                    return;
                  }
                  try {
                    const res = await fetch("/debug/build-schedule", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        chat_id: selectedChatId,
                        week_start: weekStartISO,
                        user_id: "admin1", // Admin builds the schedule
                      }),
                    });
                    const data = await res.json();
                    if (res.ok && data.ok !== false) {
                      // Update schedule state
                      setSchedule(data.schedule);
                      // Send PROPOSE to transition state COLLECTING → ACTIVE
                      await debugSend(`PROPOSE ${weekStartISO}`, "admin");
                      // Refresh week state and schedule
                      await refreshWeekState();
                      // Reload schedule to show updated slots
                      const scheduleRes = await fetch(
                        `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                      );
                      const scheduleData = await scheduleRes.json();
                      setSchedule(scheduleData);
                      alert(`График собран! ${data.assignments_created || 0} назначений, ${data.gaps || 0} пробелов. Статус: ACTIVE`);
                    } else {
                      alert(`Ошибка: ${data.error || "unknown"}`);
                    }
                  } catch (e: any) {
                    alert(`Ошибка: ${String(e?.message || e)}`);
                  }
                }}
              >
                Собрать график
              </button>
              <button type="button" onClick={async () => {
                await debugSend(`LOCK ${weekStartISO}`, "admin");
                await refreshWeekState();
              }}>
                Закрыть неделю
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "8px" }}>
              <button
                type="button"
                onClick={() => {
                  refreshWeekState();
                  if (schedule) {
                    const openGaps = schedule.gaps || [];
                    if (openGaps.length > 0) {
                      alert(`Незакрытые смены:\n${openGaps.map((g: any) => `${g.dow} ${g.from}-${g.to}: ${g.reason}`).join("\n")}`);
                    } else {
                      alert("Все смены закрыты");
                    }
                  }
                }}
              >
                Показать незакрытые смены
              </button>
              <button type="button" onClick={loadTimesheet}>
                Показать табель
              </button>
            </div>
            <div style={{ marginTop: "12px", padding: "8px", border: "1px solid #007bff", borderRadius: "4px", backgroundColor: "#e7f3ff" }}>
              <div style={{ fontSize: "0.85em", fontWeight: "bold", marginBottom: "8px" }}>Тестовые сценарии</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <button
                  type="button"
                  style={{ fontSize: "0.8em", padding: "4px 8px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                  onClick={async () => {
                    console.log("[SCENARIO A] Сборка графика");
                    if (!selectedChatId || !selectedTenant) {
                      alert("Выберите chat и tenant");
                      return;
                    }
                    try {
                        // 1. Загрузить эталонную неделю
                        console.log("[SCENARIO A] Шаг 1: Загрузка эталонной недели");
                        await debugSend(`OPEN_WEEK ${weekStartISO}`, "admin");
                        // Isa availability
                        await debugSend(`AVAIL ${weekStartISO} mon 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} tue 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} thu 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} fri 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sat 10-13`, "staff");
                        // Darina availability
                        await debugSend(`AVAIL ${weekStartISO} mon 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} tue 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} wed 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} thu 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sat 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sun 18-21`, "staff");
                        
                        // 2. Собрать график
                        console.log("[SCENARIO A] Шаг 2: Сборка графика");
                        const buildRes = await fetch("/debug/build-schedule", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            chat_id: selectedChatId,
                            week_start: weekStartISO,
                            user_id: "admin1",
                          }),
                        });
                        const buildData = await buildRes.json();
                        if (buildRes.ok && buildData.ok !== false) {
                          setSchedule(buildData.schedule);
                          // Transition to ACTIVE
                          await debugSend(`PROPOSE ${weekStartISO}`, "admin");
                          await refreshWeekState();
                          const scheduleRes = await fetch(
                            `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                          );
                          const scheduleData = await scheduleRes.json();
                          setSchedule(scheduleData);
                          console.log("[SCENARIO A] ✅ Ожидаемый результат: график собран, статус ACTIVE");
                          alert("Сценарий A завершён. Проверьте: график собран, статус ACTIVE (🟢)");
                        }
                      } catch (e: any) {
                        console.error("[SCENARIO A] Ошибка:", e);
                        alert(`Ошибка: ${String(e?.message || e)}`);
                      }
                    }}
                  >
                    Сценарий A: Сборка графика
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: "0.8em", padding: "4px 8px", backgroundColor: "#28a745", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                    onClick={async () => {
                      console.log("[SCENARIO B] Замена смены (4 замены)");
                      if (!selectedChatId || !selectedTenant) {
                        alert("Выберите chat и tenant");
                        return;
                      }
                      try {
                        const sendMsg = async (userId: string, text: string) => {
                          await fetch("/debug/send", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              tenant_id: selectedTenant,
                              chat_id: selectedChatId,
                              user_id: userId,
                              text,
                              meta: { role: "staff" },
                            }),
                          });
                          await new Promise((r) => setTimeout(r, 250));
                        };

                        // Шаг 0: Сначала собрать график (Сценарий A)
                        console.log("[SCENARIO B] Шаг 0: Сборка графика (Сценарий A)");
                        await debugSend(`OPEN_WEEK ${weekStartISO}`, "admin");
                        // Isa availability
                        await debugSend(`AVAIL ${weekStartISO} mon 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} tue 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} thu 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} fri 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sat 10-13`, "staff");
                        // Darina availability
                        await debugSend(`AVAIL ${weekStartISO} mon 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} tue 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} wed 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} thu 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sat 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sun 18-21`, "staff");
                        // Ksyusha availability (for replacements)
                        await debugSend(`AVAIL ${weekStartISO} wed 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} thu 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} fri 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sun 10-13`, "staff");
                        // Karina availability
                        await debugSend(`AVAIL ${weekStartISO} sat 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} fri 18-21`, "staff");

                        const buildRes = await fetch("/debug/build-schedule", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            chat_id: selectedChatId,
                            week_start: weekStartISO,
                            user_id: "admin1",
                          }),
                        });
                        const buildData = await buildRes.json();
                        if (!buildRes.ok || buildData.ok === false) {
                          alert(`Ошибка сборки: ${buildData.error || "unknown"}`);
                          return;
                        }
                        setSchedule(buildData.schedule);
                        await debugSend(`PROPOSE ${weekStartISO}`, "admin");
                        await refreshWeekState();

                        // Шаг 1: Замена 1 — Иса не может в чт утро → Ксюша выходит
                        console.log("[SCENARIO B] Замена 1: Иса → Ксюша (чт утро)");
                        await sendMsg("u1", "девочки, не могу в четверг утро, кто сможет?");
                        await sendMsg("u3", "я смогу выйти в чт утро");

                        // Шаг 2: Замена 2 — Дарина не может в пн вечер → Карина выходит
                        console.log("[SCENARIO B] Замена 2: Дарина → Карина (пн вечер)");
                        await sendMsg("u2", "не смогу в понедельник вечер, подмените пожалуйста");
                        await sendMsg("u4", "могу в пн вечер, подменю");

                        // Шаг 3: Замена 3 — Ксюша не может в ср утро → Иса выходит
                        console.log("[SCENARIO B] Замена 3: Ксюша → Иса (ср утро)");
                        await sendMsg("u3", "в среду утро не получится, кто может?");
                        await sendMsg("u1", "я выйду в ср утро");

                        // Шаг 4: Замена 4 — Карина не может в пт вечер → Дарина выходит
                        console.log("[SCENARIO B] Замена 4: Карина → Дарина (пт вечер)");
                        await sendMsg("u4", "пт вечер не смогу, кто свободен?");
                        await sendMsg("u2", "я смогу в пт вечер");

                        // Обновить данные
                        await loadDialogEvents(selectedChatId, selectedTenant);
                        await refreshWeekState();
                        const scheduleRes = await fetch(
                          `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                        );
                        const scheduleData = await scheduleRes.json();
                        setSchedule(scheduleData);

                        // Count replacements
                        const replacements = (scheduleData.slots || []).filter((s: any) => s.replaced_user_id);
                        console.log("[SCENARIO B] ✅ Замены в графике:", replacements.length);
                        alert(`Сценарий B завершён (4 замены).\nЗамены в графике: ${replacements.length}\n• чт утро: Ксюша за Иса\n• пн вечер: Карина за Дарина\n• ср утро: Иса за Ксюша/Дарина\n• пт вечер: Дарина за Карина\nПроверьте 🔄 в графике.`);
                      } catch (e: any) {
                        console.error("[SCENARIO B] Ошибка:", e);
                        alert(`Ошибка: ${String(e?.message || e)}`);
                      }
                    }}
                  >
                    Сценарий B: Замена (4 замены)
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: "0.8em", padding: "4px 8px", backgroundColor: "#ffc107", color: "black", border: "none", borderRadius: "4px", cursor: "pointer" }}
                    onClick={async () => {
                      console.log("[SCENARIO C] Зарплата");
                      if (!selectedChatId || !selectedTenant) {
                        alert("Выберите chat и tenant");
                        return;
                      }
                      try {
                        // 1. Загрузить табель
                        console.log("[SCENARIO C] Шаг 1: Загрузка табеля");
                        await loadTimesheet();
                        
                        // 2. Отметить работу
                        console.log("[SCENARIO C] Шаг 2: Отметка работы");
                        await debugSend(`WORKED ${weekStartISO} mon 10-13`, "staff");
                        await debugSend(`WORKED ${weekStartISO} tue 10-13`, "staff");
                        
                        // 3. Перезагрузить табель
                        await loadTimesheet();
                        
                        console.log("[SCENARIO C] ✅ Ожидаемый результат: табель показывает отработанные часы и расчёт зарплаты");
                        alert("Сценарий C завершён. Проверьте: табель показывает отработанные часы и расчёт зарплаты");
                      } catch (e: any) {
                        console.error("[SCENARIO C] Ошибка:", e);
                        alert(`Ошибка: ${String(e?.message || e)}`);
                      }
                    }}
                  >
                    Сценарий C: Зарплата
                  </button>
                </div>
              </div>
            <div style={{ fontSize: "0.75em", color: "#666", marginTop: "8px" }}>
              <div>Технические команды (для отладки):</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: "4px" }}>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px" }}
                  onClick={() => debugSend(`DECLARE_GAP ${weekStartISO} thu 18-21`, "staff")}
                >
                  DECLARE_GAP
                </button>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px" }}
                  onClick={() => debugSend(`ASSIGN ${weekStartISO} thu 18-21 u2`, "senior")}
                >
                  ASSIGN
                </button>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px" }}
                  onClick={() => debugSend(`APPROVE_OVERTIME ${weekStartISO} thu 18-21`, "owner")}
                >
                  APPROVE_OVERTIME
                </button>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px", backgroundColor: "#ffc107", color: "black", border: "none", borderRadius: "2px" }}
                  onClick={() => debugSend(`PROBLEM ${weekStartISO} mon 10-13 u1 late`, "admin")}
                >
                  PROBLEM (пн утро u1)
                </button>
              </div>
            </div>
          </section>
          <section>
            <h3>Уведомления</h3>
            {(() => {
              // Build notifications from events/facts
              const notifications: Array<{ icon: string; text: string; ts: string }> = [];

              // Scan events for replacement-related facts
              for (const [eventId, facts] of factsPerEvent.entries()) {
                const ev = events.find((e: any) => e.id === eventId);
                const ts = ev?.received_at ? new Date(ev.received_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";

                for (const f of facts) {
                  if (f.fact_type === "SHIFT_AVAILABILITY") {
                    const userName = UserDirectory.getDisplayName(ev?.user_id || f.user_id || "");
                    const dayName = ({ mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" } as Record<string, string>)[f.fact_payload?.dow] || f.fact_payload?.dow;
                    notifications.push({
                      icon: "📋",
                      text: `${userName}: доступность ${dayName} ${f.fact_payload?.from}-${f.fact_payload?.to}`,
                      ts,
                    });
                  } else if (f.fact_type === "SHIFT_UNAVAILABILITY" && f.fact_payload?.needs_replacement) {
                    const userName = UserDirectory.getDisplayName(ev?.user_id || f.user_id || "");
                    const dayName = ({ mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" } as Record<string, string>)[f.fact_payload?.dow] || f.fact_payload?.dow;
                    notifications.push({
                      icon: "⚠️",
                      text: `${dayName} ${f.fact_payload?.from}-${f.fact_payload?.to}: ${userName} не может, ищем замену`,
                      ts,
                    });
                  } else if (f.fact_type === "SHIFT_REPLACEMENT") {
                    const userName = UserDirectory.getDisplayName(ev?.user_id || f.user_id || "");
                    const dayName = ({ mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" } as Record<string, string>)[f.fact_payload?.dow] || f.fact_payload?.dow;
                    notifications.push({
                      icon: "✅",
                      text: `${dayName} ${f.fact_payload?.from}-${f.fact_payload?.to}: ${userName} вышла на замену`,
                      ts,
                    });
                  }
                }
              }

              // Show last 10 notifications (most recent first)
              const recent = notifications.slice(-10).reverse();

              return (
                <div style={{ marginTop: "8px" }}>
                  {recent.length === 0 ? (
                    <div style={{ fontSize: "0.85em", color: "#666" }}>
                      Нет уведомлений. Отправьте сообщения в чат.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {recent.map((n, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: "6px 8px",
                            backgroundColor: n.icon === "⚠️" ? "#fff3cd" : n.icon === "✅" ? "#d4edda" : "#e7f3ff",
                            borderRadius: "4px",
                            fontSize: "0.8em",
                            display: "flex",
                            gap: "6px",
                            alignItems: "flex-start",
                          }}
                        >
                          <span>{n.icon}</span>
                          <span style={{ flex: 1 }}>{n.text}</span>
                          <span style={{ fontSize: "0.75em", color: "#666", whiteSpace: "nowrap" }}>{n.ts}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </section>
          <section>
            <h3>Статус недели</h3>
            <button
              type="button"
              onClick={refreshWeekState}
            >
              Обновить статус
            </button>
            {weekStateErr && (
              <div style={{ marginTop: "8px", fontSize: "0.8em", color: "red" }}>
                Ошибка: {weekStateErr}
              </div>
            )}
            {weekStateResp && (
              <div style={{ marginTop: "8px" }}>
                {(() => {
                  const ws = translateWeekState(weekStateResp.week_state?.state || "");
                  return (
                    <div style={{ fontSize: "0.85em", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <strong>Статус:</strong>
                      <span style={{ color: ws.color, fontWeight: "bold" }}>{ws.emoji} {ws.label}</span>
                    </div>
                  );
                })()}
                {weekStateResp.week_state?.required_actions &&
                  weekStateResp.week_state.required_actions.length > 0 && (
                    <div style={{ fontSize: "0.85em", marginTop: "4px" }}>
                      <strong>Требуются действия:</strong>{" "}
                      {weekStateResp.week_state.required_actions
                        .map((action: string) => {
                          if (action.includes("uncovered shifts")) return "Незакрытые смены — нужна замена";
                          if (action.includes("replacement")) return "Нужна замена на смену";
                          return action;
                        })
                        .join(", ")}
                    </div>
                  )}
                {weekStateResp.week_state?.gaps_open &&
                  weekStateResp.week_state.gaps_open.length > 0 && (
                    <div style={{ fontSize: "0.85em", marginTop: "4px" }}>
                      <strong>Незакрытые смены:</strong>{" "}
                      {weekStateResp.week_state.gaps_open
                        .map((gap: any) => `${gap.dow} ${gap.from}-${gap.to}`)
                        .join(", ")}
                    </div>
                  )}
                <pre
                  style={{
                    fontSize: "0.75em",
                    marginTop: "8px",
                    padding: "4px",
                    backgroundColor: "#f5f5f5",
                    maxHeight: "300px",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(weekStateResp, null, 2)}
                </pre>
              </div>
            )}
          </section>
          <section>
            <h3>Подтверждение факта (проблемные смены)</h3>
            {schedule && schedule.slots && (() => {
              // Find problematic shifts that need fact confirmation
              // A shift is problematic if:
              // - is_problematic === true
              // - shift date has passed (for v1, we'll show all problematic shifts)
              const problematicSlots = schedule.slots.filter((slot: any) => 
                slot.is_problematic && slot.user_id && slot.status === "CONFIRMED"
              );

              if (problematicSlots.length === 0) {
                return (
                  <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                    Нет проблемных смен, требующих подтверждения факта
                  </div>
                );
              }

              return (
                <div style={{ marginTop: "8px" }}>
                  {problematicSlots.map((slot: any, idx: number) => {
                    const slotKey = `${slot.dow}|${slot.from}|${slot.to}`;
                    return (
                      <div key={idx} style={{ marginBottom: "12px", padding: "8px", border: "1px solid #ddd", borderRadius: "4px", backgroundColor: "#fff3cd" }}>
                        <div style={{ fontSize: "0.85em", fontWeight: "bold", marginBottom: "4px" }}>
                          {slot.user_id}: {slot.dow} {slot.from}-{slot.to} ({slot.hours?.toFixed(1)} ч)
                        </div>
                        <div style={{ fontSize: "0.75em", marginBottom: "8px", color: "#666" }}>
                          Причины: {slot.problem_reasons?.join(", ") || "проблемная смена"}
                        </div>
                        <div style={{ fontSize: "0.75em", marginBottom: "8px", color: "#666" }}>
                          Смена прошла как планировалось?
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={async () => {
                              console.log("[CONFIRM_SHIFT_FACT] Clicked OK for", slot.user_id, slot.dow, slot.from, slot.to);
                              if (!selectedTenant || !selectedChatId) {
                                alert("Выберите tenant и chat");
                                return;
                              }
                              try {
                                const res = await fetch("/debug/send", {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({
                                    tenant_id: selectedTenant,
                                    chat_id: selectedChatId,
                                    user_id: slot.user_id,
                                    text: `CONFIRM_SHIFT_FACT ${weekStartISO} ${slot.dow} ${slot.from.replace(":00", "")}-${slot.to.replace(":00", "")} ok`,
                                    meta: { role: "staff" },
                                  }),
                                });
                                const data = await res.json();
                                console.log("[CONFIRM_SHIFT_FACT] Response:", data);
                                if (data.ok) {
                                  setLastSend({
                                    event: data.event,
                                    facts: data.facts ?? [],
                                    facts_count: data.facts_count ?? 0,
                                  });
                                  // Reload schedule immediately
                                  const scheduleRes = await fetch(
                                    `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                                  );
                                  const scheduleData = await scheduleRes.json();
                                  console.log("[CONFIRM_SHIFT_FACT] Schedule reloaded:", scheduleData);
                                  setSchedule(scheduleData);
                                  // Also reload timesheet
                                  await loadTimesheet();
                                  await loadDialogEvents(selectedChatId, selectedTenant);
                                } else {
                                  console.error("[CONFIRM_SHIFT_FACT] Failed:", data);
                                  alert(`Ошибка: ${data.error || "unknown"}`);
                                }
                              } catch (err: any) {
                                console.error("[CONFIRM_SHIFT_FACT] Error:", err);
                                alert(`Ошибка: ${String(err?.message || err)}`);
                              }
                            }}
                            style={{ backgroundColor: "#28a745", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}
                          >
                            ✅ Да, всё ок
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              // For v1, we'll use a simple reason
                              const reason = prompt("Укажите причину проблемы (кратко):", "проблема");
                              if (reason === null) return; // User cancelled
                              const res = await fetch("/debug/send", {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({
                                  tenant_id: selectedTenant,
                                  chat_id: selectedChatId,
                                  user_id: slot.user_id,
                                  text: `CONFIRM_SHIFT_FACT ${weekStartISO} ${slot.dow} ${slot.from.replace(":00", "")}-${slot.to.replace(":00", "")} problem ${reason}`,
                                  meta: { role: "staff" },
                                }),
                              });
                              const data = await res.json();
                              if (data.ok) {
                                setLastSend({
                                  event: data.event,
                                  facts: data.facts ?? [],
                                  facts_count: data.facts_count ?? 0,
                                });
                              }
                              if (selectedChatId && selectedTenant) {
                                await loadDialogEvents(selectedChatId, selectedTenant);
                              }
                              await loadTimesheet();
                              // Reload schedule
                              if (selectedChatId) {
                                const scheduleRes = await fetch(
                                  `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                                );
                                const scheduleData = await scheduleRes.json();
                                setSchedule(scheduleData);
                              }
                            }}
                            style={{ backgroundColor: "#dc3545", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}
                          >
                            ⚠️ Была проблема
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>
        </div>
      </aside>
    </div>
  );
};

