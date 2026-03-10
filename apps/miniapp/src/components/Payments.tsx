import React from "react";
import { getPayments, sendPaymentsList, type PaymentsData } from "../api";
import { haptic } from "../telegram";

function fmtRub(n: number): string {
  if (!n) return "0 \u20BD";
  return Math.round(n).toLocaleString("ru-RU") + " \u20BD";
}

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const months = ["\u044F\u043D\u0432", "\u0444\u0435\u0432", "\u043C\u0430\u0440", "\u0430\u043F\u0440", "\u043C\u0430\u044F", "\u0438\u044E\u043D", "\u0438\u044E\u043B", "\u0430\u0432\u0433", "\u0441\u0435\u043D", "\u043E\u043A\u0442", "\u043D\u043E\u044F", "\u0434\u0435\u043A"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

const STATUS_ICONS: Record<string, string> = {
  subscription: "\u2713",
  makeup: "\u21A9",
  trial: "\u25CE",
  paid: "\u20BD",
  unpaid: "\u2718",
};

const STATUS_COLORS: Record<string, string> = {
  subscription: "rgba(52,199,89,0.8)",
  makeup: "rgba(0,122,255,0.8)",
  trial: "rgba(255,149,0,0.8)",
  paid: "rgba(52,199,89,0.8)",
  unpaid: "rgba(255,59,48,0.8)",
};

export const Payments: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const [date, setDate] = React.useState(getTomorrow);
  const [data, setData] = React.useState<PaymentsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [sendResult, setSendResult] = React.useState<string | null>(null);

  const load = React.useCallback((d: string) => {
    setLoading(true);
    getPayments(d).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(date); }, [date, load]);

  const navigate = (dir: -1 | 0 | 1) => {
    haptic("light");
    if (dir === 0) { setDate(getTomorrow()); return; }
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + dir);
    setDate(d.toISOString().slice(0, 10));
  };

  const handleSend = async () => {
    if (!data?.date) return;
    haptic("medium");
    setSending(true);
    setSendResult(null);
    try {
      await sendPaymentsList(data.date);
      setSendResult("ok");
    } catch (e: any) {
      setSendResult(e.message);
    }
    setSending(false);
  };

  return (
    <div>
      {/* Date navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="btn btn-secondary" style={{ width: 40, padding: 8, fontSize: 18 }} onClick={() => navigate(-1)}>&larr;</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Оплаты</div>
          <div style={{ fontSize: 13, color: "var(--tg-hint)", cursor: "pointer" }} onClick={() => navigate(0)}>
            {formatDateLabel(date)}
          </div>
        </div>
        <button className="btn btn-secondary" style={{ width: 40, padding: 8, fontSize: 18 }} onClick={() => navigate(1)}>&rarr;</button>
      </div>

      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : !data ? (
        <div className="error-box">Не удалось загрузить</div>
      ) : (
      <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{data.total_students} уч.</div>
        <div style={{ fontSize: 14, color: "var(--tg-hint)" }}>{fmtRub(data.total_amount)}</div>
      </div>

      {data.groups.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>
          Нет занятий на эту дату
        </div>
      ) : (
        data.groups.map((group, gi) => (
          <div key={gi} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{group.name}</div>
              <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>{group.time}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {group.students.map((s, si) => (
                <div key={si} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "4px 0",
                  borderBottom: si < group.students.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                }}>
                  <span style={{ fontSize: 14 }}>{s.name}</span>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: STATUS_COLORS[s.status] || "var(--tg-hint)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}>
                    {STATUS_ICONS[s.status] || "?"} {s.amount ? fmtRub(s.amount) : s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {isOwner && data.groups.length > 0 && (
        <button
          className="btn"
          disabled={sending}
          onClick={handleSend}
          style={{ marginTop: 4 }}
        >
          {sending ? "Отправка..." : "\u{1F4E9} Отправить в чат"}
        </button>
      )}
      {sendResult && (
        <div style={{
          marginTop: 8,
          fontSize: 13,
          textAlign: "center",
          color: sendResult === "ok" ? "rgba(52,199,89,1)" : "var(--tg-destructive)",
        }}>
          {sendResult === "ok" ? "\u2705 Отправлено" : sendResult}
        </div>
      )}
      </>
      )}
    </div>
  );
};
