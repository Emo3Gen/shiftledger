/**
 * Telegram WebApp SDK helpers.
 */

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    auth_date?: number;
    hash?: string;
  };
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
    header_bg_color?: string;
    section_bg_color?: string;
    accent_text_color?: string;
    section_header_text_color?: string;
    subtitle_text_color?: string;
    destructive_text_color?: string;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    setText: (text: string) => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

const isDevMode = !window.Telegram?.WebApp?.initData;

// Dev fallback
const devWebApp: TelegramWebApp = {
  initData: "",
  initDataUnsafe: {
    user: { id: 319929790, first_name: "Director" },
  },
  themeParams: {
    bg_color: "#1c1c1e",
    text_color: "#ffffff",
    hint_color: "#8e8e93",
    link_color: "#007aff",
    button_color: "#007aff",
    button_text_color: "#ffffff",
    secondary_bg_color: "#2c2c2e",
    header_bg_color: "#1c1c1e",
    section_bg_color: "#2c2c2e",
    accent_text_color: "#007aff",
    section_header_text_color: "#8e8e93",
    subtitle_text_color: "#8e8e93",
    destructive_text_color: "#ff3b30",
  },
  ready: () => {},
  expand: () => {},
  close: () => {},
  colorScheme: "dark",
  viewportHeight: 600,
  viewportStableHeight: 600,
  isExpanded: true,
  MainButton: {
    text: "", color: "", textColor: "", isVisible: false, isActive: false,
    show() {}, hide() {}, enable() {}, disable() {}, setText() {},
    onClick() {}, offClick() {}, showProgress() {}, hideProgress() {},
  },
  HapticFeedback: {
    impactOccurred() {},
    notificationOccurred() {},
    selectionChanged() {},
  },
};

export const tg: TelegramWebApp = window.Telegram?.WebApp || devWebApp;
export const initData = tg.initData;
export const user = tg.initDataUnsafe.user;
export const themeParams = tg.themeParams;

export function ready() {
  tg.ready();
  tg.expand();
}

export function haptic(type: "light" | "medium" | "heavy" = "light") {
  tg.HapticFeedback.impactOccurred(type);
}

export { isDevMode };
