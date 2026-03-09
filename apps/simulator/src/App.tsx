import { useState, useRef } from "react";

const employees = [
  { id: "u1", name: "Иса", role: "junior", hours: 10.5, pay: 2940, shifts: 3 },
  { id: "u2", name: "Дарина", role: "junior", hours: 24.5, pay: 6860, shifts: 7 },
  { id: "u3", name: "Ксюша", role: "junior", hours: 12.0, pay: 3360, shifts: 4 },
  { id: "u4", name: "Карина", role: "senior", hours: 33.0, pay: 9240, shifts: 9 },
  { id: "u6", name: "Катя", role: "junior", hours: 18.0, pay: 5040, shifts: 5 },
  { id: "u7", name: "Рита", role: "junior", hours: 14.0, pay: 3920, shifts: 4 },
];

const schedule = [
  { dow: "Пн", morning: "Иса", evening: "Дарина", cleaning: true },
  { dow: "Вт", morning: "Карина", evening: "Ксюша", cleaning: false },
  { dow: "Ср", morning: "Дарина", evening: "Карина", cleaning: true },
  { dow: "Чт", morning: "Карина", evening: "Иса", cleaning: false },
  { dow: "Пт", morning: "Дарина", evening: "Карина", cleaning: true },
  { dow: "Сб", morning: "Карина", evening: "Дарина", cleaning: true },
  { dow: "Вс", morning: "Карина", evening: "Ксюша", cleaning: false },
];

const payments = [
  { group: "МИНИ-1 (10:00)", students: [
    { name: "Петров Иван", status: "active", amount: null },
    { name: "Михаил", status: "trial", amount: "850 / 3200₽" },
    { name: "Козлов Дима", status: "unpaid", amount: "2400₽" },
  ]},
  { group: "МИНИ-2 (11:30)", students: [
    { name: "Слободенюк Роман", status: "compensation", amount: null },
    { name: "Антрушина Алисия", status: "active", amount: null },
  ]},
  { group: "ПКШК (18:30)", students: [
    { name: "Лебедев Давид", status: "compensation", amount: null },
    { name: "Сёма", status: "unpaid", amount: "4000₽" },
  ]},
];

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  active:       { label: "абонемент", color: "#4ade80", icon: "✓" },
  compensation: { label: "отработка", color: "#4ade80", icon: "↩" },
  trial:        { label: "пробное",   color: "#60a5fa", icon: "◎" },
  unpaid:       { label: "оплата",    color: "#fbbf24", icon: "₽" },
};

const THEMES: Record<string, { bg: string; card: string; border: string; text: string; muted: string; accent: string }> = {
  dark:  { bg: "#111118", card: "#18181f", border: "#23232e", text: "#f2efe9", muted: "#55546a", accent: "#FF5C35" },
  light: { bg: "#f5f4f0", card: "#ffffff", border: "#e5e4e0", text: "#1a1a2e", muted: "#9998b0", accent: "#FF5C35" },
  blue:  { bg: "#0d1117", card: "#161b22", border: "#21262d", text: "#e6edf3", muted: "#484f58", accent: "#2f81f7" },
};

function PhoneApp({ theme, screen, setScreen }: { theme: string; screen: string; setScreen: (s: string) => void }) {
  const T = THEMES[theme];
  const totalPay = employees.reduce((s, e) => s + e.pay, 0);
  const totalHours = employees.reduce((s, e) => s + e.hours, 0);
  const unpaidCount = payments.reduce((s, g) => s + g.students.filter(st => st.status === "unpaid" || st.status === "trial").length, 0);

  return (
    <div style={{ width: "100%", height: "100%", background: T.bg, color: T.text, fontFamily: "'DM Mono', monospace", overflowY: "auto", position: "relative" }}>
      {/* Status bar */}
      <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", fontSize: 11, color: T.muted }}>
        <span>9:41</span><span>••••</span>
      </div>

      {/* Header */}
      <div style={{ padding: "0 16px 14px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            {screen !== "dashboard" && (
              <button onClick={() => setScreen("dashboard")} style={{ background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", padding: "0 0 2px", display: "block" }}>← назад</button>
            )}
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: 2, textTransform: "uppercase" }}>
              {screen === "dashboard" ? "Про Дети · директор" : screen === "schedule" ? "График" : screen === "payroll" ? "Табель" : "Оплаты"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5, marginTop: 1 }}>
              {screen === "dashboard" ? "Дашборд" : screen === "schedule" ? "09–15 марта" : screen === "payroll" ? "Март 2026" : "09 марта, пн"}
            </div>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg, ${T.accent}, #f59e0b)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff" }}>С</div>
        </div>
      </div>

      {/* Dashboard */}
      {screen === "dashboard" && (
        <div style={{ padding: "16px 12px 90px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[
              { label: "Сотрудников", value: employees.length, sub: "активных", color: T.text },
              { label: "ФОТ март", value: (totalPay/1000).toFixed(1)+"к₽", sub: "к выплате", color: "#4ade80" },
              { label: "Часов/нед", value: Math.round(totalHours/4), sub: "средняя нагрузка", color: T.text },
              { label: "Нужна оплата", value: unpaidCount, sub: "учеников", color: "#fbbf24" },
            ].map((s, i) => (
              <div key={i} style={{ background: T.card, borderRadius: 14, padding: "14px", border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 9, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -1, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
            {[
              { icon: "◫", label: "График на неделю", sub: "09–15 марта", screen: "schedule", dot: null as number | null },
              { icon: "₽", label: "Список оплат", sub: `${unpaidCount} учеников`, screen: "payments", dot: unpaidCount },
              { icon: "◈", label: "Табель / Зарплата", sub: "март 2026", screen: "payroll", dot: null as number | null },
            ].map((a, i) => (
              <button key={i} onClick={() => setScreen(a.screen)} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left", color: T.text, width: "100%" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: T.accent + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: T.accent, flexShrink: 0 }}>{a.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>{a.sub}</div>
                </div>
                {a.dot ? <div style={{ background: "#fbbf24", color: "#111", borderRadius: 20, fontSize: 11, fontWeight: 700, minWidth: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{a.dot}</div> : <span style={{ color: T.muted }}>›</span>}
              </button>
            ))}
          </div>
          <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, overflow: "hidden" }}>
            {employees.map((e, i) => (
              <div key={e.id} style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < employees.length-1 ? `1px solid ${T.border}` : "none" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: `hsl(${i*55+10},55%,32%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{e.name[0]}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.name}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{e.role} · {e.hours}ч</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#4ade80" }}>{e.pay.toLocaleString("ru")}₽</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule */}
      {screen === "schedule" && (
        <div style={{ padding: "16px 12px 90px" }}>
          {schedule.map((day, i) => (
            <div key={i} style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: "12px 14px", marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: i===0 ? T.accent : T.text }}>{day.dow}</div>
                {day.cleaning && <div style={{ fontSize: 10, color: T.muted, background: T.border, borderRadius: 5, padding: "2px 7px" }}>🧹 уборка</div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {[{ label: "Утро", name: day.morning }, { label: "Вечер", name: day.evening }].map((slot, j) => (
                  <div key={j} style={{ background: T.bg, borderRadius: 9, padding: "9px 11px", border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: 1 }}>{slot.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{slot.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button style={{ width: "100%", marginTop: 6, padding: "13px", background: `linear-gradient(135deg, ${T.accent}, #f59e0b)`, border: "none", borderRadius: 14, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>📤 Опубликовать в Telegram</button>
        </div>
      )}

      {/* Payments */}
      {screen === "payments" && (
        <div style={{ padding: "16px 12px 90px" }}>
          {payments.map((group, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: T.accent, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 7, fontWeight: 700, paddingLeft: 2 }}>{group.group}</div>
              <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                {group.students.map((st, j) => {
                  const cfg = statusConfig[st.status];
                  return (
                    <div key={j} style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: j < group.students.length-1 ? `1px solid ${T.border}` : "none" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: cfg.color+"18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: cfg.color, fontWeight: 700 }}>{cfg.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13 }}>{st.name}</div>
                        <div style={{ fontSize: 10, color: cfg.color, marginTop: 1 }}>{cfg.label}</div>
                      </div>
                      {st.amount && <div style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24" }}>{st.amount}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <button style={{ width: "100%", marginTop: 4, padding: "13px", background: `linear-gradient(135deg, #fbbf24, ${T.accent})`, border: "none", borderRadius: 14, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>📤 Отправить в чат</button>
        </div>
      )}

      {/* Payroll */}
      {screen === "payroll" && (
        <div style={{ padding: "16px 12px 90px" }}>
          <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: "14px", marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: 1 }}>ФОТ итого</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#4ade80", marginTop: 3 }}>{totalPay.toLocaleString("ru")}₽</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: 1 }}>Часов всего</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 3 }}>{totalHours}ч</div>
            </div>
          </div>
          <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, overflow: "hidden" }}>
            <div style={{ padding: "9px 14px", display: "grid", gridTemplateColumns: "1fr 48px 80px", fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: 1, borderBottom: `1px solid ${T.border}` }}>
              <span>Сотрудник</span><span style={{ textAlign: "right" }}>Часы</span><span style={{ textAlign: "right" }}>ЗП</span>
            </div>
            {employees.map((e, i) => (
              <div key={e.id} style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 48px 80px", alignItems: "center", borderBottom: i < employees.length-1 ? `1px solid ${T.border}` : "none" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.name}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{e.shifts} смен</div>
                </div>
                <div style={{ fontSize: 12, textAlign: "right", color: T.muted }}>{e.hours}ч</div>
                <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right", color: "#4ade80" }}>{e.pay.toLocaleString("ru")}₽</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div style={{ position: "sticky", bottom: 0, background: T.bg, borderTop: `1px solid ${T.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", padding: "8px 0 16px" }}>
        {[
          { icon: "⊞", label: "Главная", s: "dashboard" },
          { icon: "◫", label: "График", s: "schedule" },
          { icon: "₽", label: "Оплаты", s: "payments" },
          { icon: "◈", label: "Табель", s: "payroll" },
        ].map((n, i) => (
          <button key={i} onClick={() => setScreen(n.s)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", color: screen === n.s ? T.accent : T.muted }}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            <span style={{ fontSize: 9, letterSpacing: 0.5 }}>{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Сделай светлую тему",
  "Добавь экран входа по PIN",
  "Измени акцент на синий",
  "Добавь аватарки сотрудников",
  "Покажи график как горизонтальный календарь",
];

export default function Studio() {
  const [screen, setScreen] = useState("dashboard");
  const [theme, setTheme] = useState("dark");
  const [messages, setMessages] = useState([
    { role: "ai", text: "Привет! Я помогу настроить дизайн мини-аппа. Нажимайте на экраны слева и давайте команды — что изменить, добавить или убрать." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: msg }]);
    setLoading(true);

    // Simple command parsing
    setTimeout(() => {
      let reply = "";
      const lower = msg.toLowerCase();

      if (lower.includes("светл") || lower.includes("light")) {
        setTheme("light");
        reply = "Переключил на светлую тему ☀️";
      } else if (lower.includes("тёмн") || lower.includes("dark")) {
        setTheme("dark");
        reply = "Переключил на тёмную тему 🌙";
      } else if (lower.includes("синий") || lower.includes("blue")) {
        setTheme("blue");
        reply = "Переключил на синюю тему 💙";
      } else if (lower.includes("график") || lower.includes("schedule")) {
        setScreen("schedule");
        reply = "Открыл экран графика 📅";
      } else if (lower.includes("оплат") || lower.includes("payment")) {
        setScreen("payments");
        reply = "Открыл экран оплат 💰";
      } else if (lower.includes("табел") || lower.includes("payroll") || lower.includes("зп") || lower.includes("зарп")) {
        setScreen("payroll");
        reply = "Открыл экран табеля 📊";
      } else if (lower.includes("дашборд") || lower.includes("главн")) {
        setScreen("dashboard");
        reply = "Вернул на дашборд 🏠";
      } else {
        reply = `Команда принята: «${msg}». Для реализации этого изменения скопируйте запрос и отправьте в Claude Code — он внесёт правки в код прототипа.`;
      }

      setMessages(m => [...m, { role: "ai", text: reply }]);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }, 500);
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0a0a0f", fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>

      {/* LEFT: Phone preview */}
      <div style={{ width: "45%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px", borderRight: "1px solid #1e1e2a" }}>
        <div style={{ fontSize: 11, color: "#444", letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Превью · {theme === "dark" ? "Тёмная" : theme === "light" ? "Светлая" : "Синяя"} тема</div>

        {/* Phone frame */}
        <div style={{
          width: 300, height: 620,
          background: "#1a1a1a",
          borderRadius: 44,
          padding: "10px 8px",
          boxShadow: "0 30px 80px rgba(0,0,0,0.8), inset 0 0 0 1px #333",
          position: "relative",
        }}>
          {/* Notch */}
          <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 80, height: 22, background: "#111", borderRadius: 11, zIndex: 10 }} />
          {/* Screen */}
          <div style={{ width: "100%", height: "100%", borderRadius: 36, overflow: "hidden", background: "#111" }}>
            <PhoneApp theme={theme} screen={screen} setScreen={setScreen} />
          </div>
        </div>

        {/* Theme switcher */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {([["dark","🌙 Тёмная"],["light","☀️ Светлая"],["blue","💙 Синяя"]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTheme(t)} style={{
              padding: "6px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
              background: theme === t ? "#FF5C35" : "#1a1a1a",
              color: theme === t ? "#fff" : "#666",
              border: `1px solid ${theme === t ? "#FF5C35" : "#333"}`,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* RIGHT: Chat panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0d0d14" }}>
        {/* Chat header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e1e2a" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#f0ede8" }}>Дизайн-ассистент</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Давайте команды на правку UI</div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              maxWidth: "85%",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              background: m.role === "user" ? "#FF5C35" : "#1a1a24",
              color: m.role === "user" ? "#fff" : "#d0cde8",
              borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              padding: "10px 14px",
              fontSize: 13,
              lineHeight: 1.5,
              border: m.role === "ai" ? "1px solid #23232e" : "none",
            }}>{m.text}</div>
          ))}
          {loading && (
            <div style={{ alignSelf: "flex-start", background: "#1a1a24", borderRadius: "16px 16px 16px 4px", padding: "10px 16px", border: "1px solid #23232e" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF5C35", animation: `pulse 1s ${i*0.2}s infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        <div style={{ padding: "0 20px 8px", display: "flex", gap: 6, overflowX: "auto" }}>
          {SUGGESTIONS.map((s, i) => (
            <button key={i} onClick={() => send(s)} style={{
              whiteSpace: "nowrap", padding: "5px 10px", borderRadius: 12, fontSize: 11,
              background: "#1a1a24", color: "#888", border: "1px solid #23232e", cursor: "pointer",
            }}>{s}</button>
          ))}
        </div>

        {/* Input */}
        <div style={{ padding: "8px 20px 20px", display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Напишите команду на правку..."
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 16, fontSize: 13,
              background: "#1a1a24", border: "1px solid #23232e", color: "#f0ede8",
              outline: "none",
            }}
          />
          <button onClick={() => send()} style={{
            padding: "12px 18px", borderRadius: 16, background: "#FF5C35",
            border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>→</button>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }`}</style>
    </div>
  );
}
