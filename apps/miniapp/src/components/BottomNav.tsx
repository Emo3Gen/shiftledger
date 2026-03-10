import React from "react";
import { haptic } from "../telegram";

type Screen = "dashboard" | "schedule" | "payments" | "payroll" | "settings";

const tabs: Array<{ id: Screen; icon: string; label: string }> = [
  { id: "dashboard", icon: "\u{1F3E0}", label: "Главная" },
  { id: "schedule", icon: "\u{1F4C5}", label: "График" },
  { id: "payments", icon: "\u{1F4B3}", label: "Оплаты" },
  { id: "payroll", icon: "\u{1F4B0}", label: "Табель" },
  { id: "settings", icon: "\u2699\uFE0F", label: "Настройки" },
];

export const BottomNav: React.FC<{
  current: Screen;
  onChange: (s: Screen) => void;
}> = ({ current, onChange }) => {
  return (
    <nav style={{
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 390,
      background: "var(--tg-secondary-bg)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      justifyContent: "space-around",
      padding: "6px 0 env(safe-area-inset-bottom, 8px)",
      zIndex: 100,
    }}>
      {tabs.map((tab) => {
        const active = current === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => {
              if (!active) {
                haptic("light");
                onChange(tab.id);
              }
            }}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: active ? "var(--tg-link)" : "var(--tg-hint)",
              fontSize: 18,
              padding: "4px 0",
              transition: "color 0.15s",
            }}
          >
            <span>{tab.icon}</span>
            <span style={{ fontSize: 9, fontWeight: active ? 600 : 400 }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
