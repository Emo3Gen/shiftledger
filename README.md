# ShiftLedger

A Flutter web application for shift management and payroll calculation in a daycare center.

## Overview

ShiftLedger is a mobile-first Flutter Web app designed to work as a Telegram Mini App. It provides:

- **Shift Management**: Track employee shifts (morning/evening slots)
- **Cleaning Records**: Monitor and record cleaning tasks with automatic flagging for unplanned cleanings
- **Extra Classes**: Track additional paid classes and calculate compensation based on children count
- **Payroll Calculation**: Automated salary calculation combining:
  - Base hourly pay
  - Cleaning task bonuses
  - Extra class earnings

## Features

### For Administrators
- View and manage all shifts in a week grid
- Assign employees to shifts
- Edit shift hours and notes
- Record cleaning tasks and extra classes
- View detailed salary breakdowns
- Configure cleaning rules and extra class types
- Manage employee information and rates

### For Employees
- View personal weekly schedule
- Mark cleaning tasks as completed
- Log extra classes taught
- View personal salary calculation

## Project Structure

```
backend/              # Express 5 API server
  server.js           # Main server + debug endpoints
  factsParserV0.js    # NL/DSL parser (Russian + English)
  scheduleEngineV0.js # Auto-scheduling engine
  telegram/           # Telegram bot (grammY)
  __tests__/          # Jest tests
apps/simulator/       # Chat Simulator (React + Vite)
  src/App.tsx         # 3-column debug UI
```

## Getting Started

### Prerequisites
- Node.js 18+
- Supabase project (or local)

### Backend

```bash
cd backend
cp .env.example .env.dev   # fill in SUPABASE_URL, SUPABASE_KEY
npm install
npm test                   # 132 tests
node server.js             # http://localhost:3000
```

### Chat Simulator

```bash
# 1. Start the backend first (port 3000)
node backend/server.js

# 2. Start the simulator (port 4173)
cd apps/simulator
npm install
npm run dev
# Open http://localhost:4173
```

The simulator proxies `/debug/*`, `/api/*`, `/health` to the backend via Vite dev server.

**3-column layout:**
- Left: tenant selector + dialog list
- Center: chat window with message input
- Right: debug panel (facts, schedule grid, timesheet, week state)

### Swagger UI

```
http://localhost:3000/api-docs
```

## Current Status

MVP with NL parser (Russian), Telegram bot, schedule engine, timesheet calculator, and debug simulator.

## License

Private project

## Author

Emo3Gen
