import React from "react";

export interface BotModePanelProps {
  botMode: string | null;
  botModeLoading: boolean;
  changeBotMode: (mode: string) => void;
  emogenSilent: boolean | null;
  emogenStatusErr: string | null;
  emogenToggling: boolean;
  setEmogenSilent: (v: boolean | null) => void;
  setEmogenToggling: (v: boolean) => void;
  fetchEmogenStatus: () => void;
}

const BOT_MODES = [
  { mode: "manual", icon: "🖐", label: "Ручной", bg: "#fff3e0", border: "#ffcc80" },
  { mode: "auto", icon: "🤖", label: "Авто", bg: "#e8f5e9", border: "#a5d6a7" },
  { mode: "debug", icon: "🔍", label: "Отладка", bg: "#e3f2fd", border: "#90caf9" },
] as const;

const MODE_DESCRIPTIONS: Record<string, string> = {
  manual: "Бот молчит в группе. Публикация только вручную из панели.",
  auto: "Бот публикует график и оплаты автоматически.",
  debug: "Бот перехватывает отправки в группу → шлёт в личку директора с [DEBUG].",
};

export const BotModePanel: React.FC<BotModePanelProps> = ({
  botMode,
  botModeLoading,
  changeBotMode,
  emogenSilent,
  emogenStatusErr,
  emogenToggling,
  setEmogenSilent,
  setEmogenToggling,
  fetchEmogenStatus,
}) => {
  return (
    <>
      {/* Bot mode */}
      <div style={{ marginTop: 4, marginBottom: 10, padding: "8px 10px", background: "#f0f4ff", border: "1px solid #c8d6f0", borderRadius: 6 }}>
        <div style={{ fontWeight: "bold", marginBottom: 6 }}>Режим бота</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {BOT_MODES.map((m) => (
            <button
              key={m.mode}
              disabled={botModeLoading}
              onClick={() => changeBotMode(m.mode)}
              style={{
                padding: "4px 10px", fontSize: "var(--font-xs)", cursor: botModeLoading ? "not-allowed" : "pointer",
                background: botMode === m.mode ? m.bg : "#f5f5f5",
                border: `2px solid ${botMode === m.mode ? m.border : "#ddd"}`,
                borderRadius: 4, fontWeight: botMode === m.mode ? 700 : 400,
                opacity: botModeLoading ? 0.6 : 1,
              }}
            >{m.icon} {m.label}</button>
          ))}
        </div>
        <div style={{ fontSize: "0.85em", color: "#555" }}>
          {botMode ? MODE_DESCRIPTIONS[botMode] : "Загрузка..."}
        </div>
      </div>

      {/* Emogen bot: status + Silent Mode */}
      <div style={{ marginTop: 4, marginBottom: 10, padding: "8px 10px", background: "#f8f9fa", border: "1px solid #e0e0e0", borderRadius: 6 }}>
        <div style={{ fontWeight: "bold", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
          Emogen бот
          {emogenStatusErr && <span style={{ color: "#c00", fontWeight: "normal", fontSize: "0.9em" }}>{emogenStatusErr}</span>}
          {emogenSilent === null && !emogenStatusErr && <span style={{ color: "#888", fontWeight: "normal", fontSize: "0.85em" }}>проверка...</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {emogenSilent !== null && (
            <span style={{ fontSize: "0.9em", color: emogenSilent ? "#c00" : "#080" }}>
              {emogenSilent ? "🔇 Тихий режим" : "📢 Активен"}
            </span>
          )}
          <button
            disabled={emogenToggling || emogenSilent === null}
            style={{
              padding: "3px 10px", fontSize: "var(--font-xs)", cursor: emogenToggling || emogenSilent === null ? "not-allowed" : "pointer",
              background: emogenSilent ? "#e8f5e9" : "#fce4ec",
              border: "1px solid " + (emogenSilent ? "#a5d6a7" : "#ef9a9a"),
              borderRadius: 4, opacity: emogenToggling ? 0.6 : 1,
            }}
            onClick={async () => {
              if (emogenSilent === null) return;
              setEmogenToggling(true);
              try {
                const r = await fetch("/api/emogen/silent-mode", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ enabled: !emogenSilent }),
                });
                if (!r.ok) throw new Error(`${r.status}`);
                setEmogenSilent(!emogenSilent);
              } catch (e: any) {
                alert("Ошибка: " + (e.message || e));
              }
              setEmogenToggling(false);
            }}
          >
            {emogenToggling ? "..." : emogenSilent ? "📢 Включить" : "🔇 Выключить"}
          </button>
          <button
            style={{ padding: "3px 8px", fontSize: "var(--font-xs)", cursor: "pointer", background: "#f5f5f5", border: "1px solid #ccc", borderRadius: 3 }}
            onClick={fetchEmogenStatus}
          >{"⟳"}</button>
        </div>
      </div>
    </>
  );
};
