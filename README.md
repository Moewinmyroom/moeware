# Moeware — private daily coach (PWA)

A calm, Japandi-styled coach you can talk to every day. It ranks your day, keeps
long-term goals, and remembers the long arc — all on-device. Built for an AuDHD CEO
who wants the heavy thinking done in the background.

Local-first. Your Gemini key and all data stay in your phone's browser. Nothing is
committed to git.

## Three screens
- **Chat** — the home. A morning brief, your inline plan cards, and the conversation.
  The coach writes the plan, updates goals, and manages memory behind the scenes.
- **News** — a generic public Hacker News front page plus your RSS feeds, read
  **directly from the source**. Nothing here is built from your goals, chats, or memory,
  and no third-party proxy is used unless you explicitly enable one in Settings.
- **Settings** — connection, project context, goals, durable memory, feeds,
  history search, backups, and a live master-prompt preview.

## Where the API key goes (read this)
**Do not put the key in the code.** This is a static site — anything in the files is
visible to anyone who can open the page, and a deployed URL is not truly private.
1. Get a key at https://aistudio.google.com/apikey
2. Open the app → **Settings** → paste it into **Gemini API key** → **Save**.
3. It is stored only in that browser and sent only to Google, only when you use the coach.

If you see a setup banner on Chat, you haven't saved a key yet.

## Memory model (built for a year)
It is deliberately two-tier, so a year of daily chat stays fast and cheap:
- **Archive (IndexedDB)** — every message, forever, searchable in
  Settings → *Search all history*. Stored locally, never sent wholesale to the model.
- **Working memory** what actually goes into each prompt:
  - **Durable facts** you or the coach curate (Settings → *Durable memory*).
  - **Rolling summary** — once ~40 messages pile up, the coach compresses the oldest
    ones into a short factual summary. Raw messages are then marked covered but **kept**.
  - **Recent transcript** — the last ~14 messages.
  - **Retrieval** — a local keyword search always runs; when *Semantic memory* is enabled
    (Settings), a small embedding model (`all-MiniLM-L6-v2` via transformers.js) also
    searches the whole archive **by meaning**. The model runs on-device; only the one-time
    ~23 MB download touches the network, and it's browser-cached for offline use. Vectors
    are stored in IndexedDB (`vectors` store) and older messages are indexed in the
    background. Embeddings never leave the device.

The **master prompt** is short and stable; the live date/goals/facts/summary/tasks are
assembled into a separate context block on each call. Preview it in Settings.

## What the coach can do (capabilities)
The master prompt is short and static; the live date/goals/facts/summary/tasks are assembled
separately, so context starts lean. In any reply the coach can drive the app via one JSON block:
- **brief** — the morning brief (today's focus, this week, the north star).
- **tasks** — add or update today's tasks (matched by title), mark them **completed**, or **drop** them.
- **goals** — long-term outcomes with progress 0–100 and an optional **horizon** ("this week",
  "this month") so it plans across timelines without asking you to.
- **facts** — durable memory: people, decisions, commitments, constraints (max 3/reply).
- **feeds** — suggest a public RSS feed; it appears in Settings → News feeds for you to read.
- **reroute** — a one-line course-correction when effort drifts from goals.

It knows today's date; recent and retrieved messages are date-labelled, and the rolling summary
keeps the long arc with dates — so it can reason about what happened and when, including
"what did I finish last week".

## Models & automatic fallback
Gemini sometimes returns `503` when a model is overloaded. Moeware doesn't stop — it walks
down a tier list (`gemini-3.8-flash → 3.7 → 3.6 → 3.5 → 3.5-flash-lite → 3.1-pro` by default)
until one answers, briefly skips the overloaded primary, and shows the model it actually used
in a small line **above the chat** (`via gemini-3.6-flash · fallback`). Edit the order in
**Settings → Auto-fallback chain** (comma-separated). A failed message gets a **Retry** button.

## Run locally
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
A server is required now (IndexedDB + service worker). Opening the file directly won't work.

## Put it on your phone
1. Push to GitHub. (A **private** repo needs GitHub Pro/Team for Pages; otherwise the
   Pages URL is public-but-obscure — which is fine, since no key or data is on the server.)
2. Repo → Settings → Pages → Deploy from branch → `main` / root.
3. On your phone, open the Pages URL, then:
   - **iOS:** Share → Add to Home Screen.
   - **Android:** ⋮ → Install app.
4. Open the installed app → **Settings** → add your key → set a goal or two.
5. Optional: enable **Semantic memory** in Settings (one-time ~23 MB model download,
   then on-device/offline). If it can't load, the app silently falls back to keyword search.

## Will it auto-update from the repo?
Mostly yes. The service worker is **network-first**: when you're online it fetches the
latest files, and only falls back to its cache offline. So a pushed change shows up.
- When an update is installed you'll see **"Update ready — tap to reload"** — tap it.
- If you ever see a stale version, force it: close the app fully and reopen, or
  reload twice. On iOS you can also delete and re-add the Home Screen icon.
- Bump `CACHE` in `sw.js` only if you want to force every device to drop old caches.

## Privacy
- Everything (messages, goals, facts, key, embeddings) lives in this browser's storage on this device.
- **What leaves the device:** only what's required to (a) get a reply from Google's Gemini
  when you use the coach, and (b) download the embedding model once (if enabled). Your
  goals, chats, and memory are **not** sent anywhere else.
- **News is unpersonalized.** Feeds are fetched directly; the front page is a public,
  query-free request. The optional feed proxy (Settings) is **off by default** — enabling
  it sends the feed URL to `allorigins.win`.
- Export a full backup anytime (Settings → Data → Export). Import restores it.
- Lost phone? Revoke the AI Studio key. The data was only on that device.

> If you want *zero* data leaving — no Gemini — the app would need a local LLM (e.g. WebLLM),
> which is slower and heavier on a phone. Say the word and I can add it as an option.
