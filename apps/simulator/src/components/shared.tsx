import React from "react";

// UserDirectory for displaying employee names
export const UserDirectory = {
  users: new Map<string, { id: string; displayName: string; ratePerHour: number; role: string; minHours: number }>([
    ["u1", { id: "u1", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["u2", { id: "u2", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["u3", { id: "u3", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["u4", { id: "u4", displayName: "Карина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["isa", { id: "u1", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["daria", { id: "u2", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["ksu", { id: "u3", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["karina", { id: "u4", displayName: "Карина", ratePerHour: 280, role: "junior", minHours: 20 }],
  ]),
  getDisplayName(userId: string): string {
    const user = this.users.get(userId);
    if (user) return user.displayName;
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

// Formatting helpers
export function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

export function fmtRub(n: number | null | undefined): string {
  if (n == null || n === 0) return "0 ₽";
  const s = Math.round(n).toString();
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return parts.join("\u2009") + " ₽";
}

// InfoTip: small ⓘ icon with hover tooltip
export const InfoTip: React.FC<{ text: string }> = ({ text }) => {
  const [show, setShow] = React.useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block", marginLeft: 4, cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow((p) => !p)}
    >
      <span style={{ fontSize: 13, color: "#aaa", userSelect: "none" }}>{"\u24D8"}</span>
      {show && (
        <span style={{
          position: "absolute", left: "50%", top: "100%", transform: "translateX(-50%)",
          marginTop: 4, padding: "6px 10px", background: "#fff", border: "1px solid #ddd",
          borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", fontSize: 12,
          color: "#333", lineHeight: 1.4, maxWidth: 250, minWidth: 150, whiteSpace: "normal",
          zIndex: 50, pointerEvents: "none",
        }}>{text}</span>
      )}
    </span>
  );
};
