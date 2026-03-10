# Telegram Mini App Setup

## 1. BotFather Configuration

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/mybots` and select your bot
3. Go to **Bot Settings** > **Menu Button**
4. Set the menu button URL to:
   ```
   https://YOUR_DOMAIN/miniapp/
   ```
5. Set the button text: `ShiftLedger`

Alternatively, use the `/setmenubutton` command:
```
/setmenubutton
> Select your bot
> URL: https://YOUR_DOMAIN/miniapp/
> Text: ShiftLedger
```

## 2. Environment Variables

Add to your `.env` (or `.env.production`):

```bash
# Required (already set for the bot)
TELEGRAM_BOT_TOKEN=your-bot-token

# Optional: group chat ID for schedule/facts queries
TELEGRAM_GROUP_CHAT_ID=-100xxxxxxxxxx

# Optional: admin chat ID (already set)
ADMIN_CHAT_ID=319929790
```

## 3. Development

```bash
# Install miniapp dependencies
cd apps/miniapp && npm install

# Start miniapp dev server (port 5174)
npm run dev

# Start backend (port 3000) in another terminal
cd backend && node server.js
```

The Vite dev server proxies `/api` requests to `localhost:3000`.

In dev mode (no `TELEGRAM_BOT_TOKEN` or empty `initData`), auth is bypassed with a hardcoded dev user (id: 319929790).

## 4. Production Build

```bash
cd apps/miniapp && npx vite build
```

The build output goes to `apps/miniapp/dist/` and is served by Express at `/miniapp/`.

## 5. Architecture

```
Telegram WebApp SDK
  └─ initData (HMAC-signed by Telegram)
      └─ POST /api/miniapp/auth
          ├─ validates initData HMAC
          ├─ looks up employee by telegram_user_id
          └─ returns session token (HMAC-based, 24h TTL)

Session token (Bearer header)
  └─ GET /api/miniapp/dashboard  — KPI + team
  └─ GET /api/miniapp/schedule   — week grid
  └─ GET /api/miniapp/payments   — payment list
  └─ GET /api/miniapp/payroll    — timesheet
  └─ POST /api/miniapp/schedule/publish    — publish to Telegram
  └─ POST /api/miniapp/payments/send-list  — send to Telegram
```

## 6. Auth Flow

1. Telegram opens the Mini App with `initData` (user info + HMAC signature)
2. Frontend sends `initData` to `POST /api/miniapp/auth`
3. Backend validates HMAC using `HMAC-SHA256("WebAppData", BOT_TOKEN)` per [Telegram spec](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
4. Finds employee by `telegram_user_id` in Supabase
5. Returns a session token: `userId.role.employeeId.expiry.hmac`
6. Frontend stores token in `sessionStorage` and sends as `Authorization: Bearer <token>`

## 7. Roles

- **owner / director / admin** — full access, can publish schedule and send payments
- **staff** — can view schedule and their own payroll row
- **viewer** — can view dashboard and schedule (no employee record linked)
