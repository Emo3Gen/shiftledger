# Local Debug Pipeline (Backend + Worker + Supabase)

This document describes how to run the local ingestion pipeline on macOS and Windows.

Pipeline:

Chat client → Cloudflare Worker (proxy) → Node/Express backend → Supabase `public.events`

## 1. Supabase setup

1. In your Supabase project, open the **SQL Editor**.
2. Copy the contents of `sql/001_create_events.sql` from this repo and run it once (creates `public.events`).
3. Then copy `sql/002_create_facts.sql` and run it (creates `public.facts`).

## 2. Backend environment

Create `backend/.env.dev` with:

```bash
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
PORT=3000
```

Optionally, create `backend/.env.prod` for production with different keys.

The backend chooses env file like this:

- Reads `APP_ENV` from the OS environment.
- If not set, defaults to `dev`.
- Loads `backend/.env.<APP_ENV>` via `backend/env.js`.

> Note: `backend/.env.example` should contain the same keys as above, without real secrets.

## 3. Install backend dependencies

```bash
cd backend
npm install
```

## 4. Run backend (macOS and Windows)

Backend scripts are OS‑agnostic; they do **not** rely on inline env assignment.

```bash
cd backend
npm run dev
```

This starts the server on `http://127.0.0.1:3000` using `.env.dev` (default `APP_ENV=dev`).

Healthcheck:

```bash
curl -i http://127.0.0.1:3000/health
```

## 5. Configure Worker proxy

In `wrangler.toml` you should have:

```toml
[vars]
DEV_BACKEND_URL = "http://127.0.0.1:3000"
```

The Worker code (`worker/proxy.js`) forwards requests as‑is:

```js
export default {
  async fetch(request, env) {
    const backend = env.DEV_BACKEND_URL || env.PROD_BACKEND_URL;

    if (!backend) {
      return new Response(
        "Neither DEV_BACKEND_URL nor PROD_BACKEND_URL is configured",
        { status: 500 },
      );
    }

    const url = new URL(request.url);
    const targetUrl = backend + url.pathname + url.search;

    return fetch(targetUrl, request);
  },
};
```

## 6. Run Worker locally

From the repo root:

```bash
cd /Users/evgenij/shiftledger   # or your clone path
npx wrangler dev --ip 127.0.0.1 --port 8787
```

You should see `Ready on http://127.0.0.1:8787`.

## 7. Test ingestion

Use the provided script:

```bash
cd /Users/evgenij/shiftledger
bash scripts/ingest_demo.sh
```

It will:

1. POST to `http://127.0.0.1:3000/ingest`.
2. POST to `http://127.0.0.1:8787/ingest` (via Worker).

Both calls send the same JSON payload:

```json
{
  "source": "emu",
  "chat_id": "debug_chat",
  "user_id": "isa",
  "text": "Пн утро могу, но с 10 до 13",
  "meta": { "role": "staff" }
}
```

Expected results:

- HTTP `200 OK` with body: `{ "ok": true, "trace_id": "...", "received_at": "..." }`.
- Backend logs lines like:

```text
[INGEST] trace_id=... chat_id=debug_chat user_id=isa
```

- New rows appear in `public.events` in Supabase.

## 8. Parse events into facts

To ingest and then parse a scenario from `scenarios/week1.jsonl`:

```bash
cd /Users/evgenij/shiftledger
bash scripts/replay_and_parse.sh scenarios/week1.jsonl
```

This will:

1. Send each line as `/ingest` via Worker.
2. Resolve the created event by `trace_id`.
3. Call `/parse/:event_id` to create facts.

You can then inspect:

```bash
curl "http://127.0.0.1:3000/events?chat_id=c1&limit=20"
curl "http://127.0.0.1:3000/facts?chat_id=c1&limit=20"
```


