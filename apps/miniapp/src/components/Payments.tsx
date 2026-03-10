import React from "react";
import { getPayments, sendPaymentsList, type PaymentsData } from "../api";
import { haptic } from "../telegram";

function fmtRub(n: number): string {
  if (!n) return "0 \u20BD";
  return Math.round(n).toLocaleString("ru-RU") + " \u20BD";
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
  const [data, setData] = React.useState<PaymentsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [sendResult, setSendResult] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    getPayments()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div className="loading">Загрузка...</div>;
  if (!data) return <div className="error-box">Не удалось загрузить</div>;

  const tomorrow = new Date(data.date + "T12:00:00");
  const dateLabel = `${tomorrow.getDate()} ${["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][tomorrow.getMonth()]}`;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Оплаты</div>
          <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>на {dateLabel}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{data.total_students} уч.</div>
          <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>{fmtRub(data.total_amount)}</div>
        </div>
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
    </div>
  );
};
