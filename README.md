# Coach

A private, local-first coach with a warm voice, a little humor, and honest accountability. A static PWA: no build step, server account, or analytics.

## Run

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. Use HTTPS when hosting. In Settings, save your Gemini API key and add some context about yourself. The key stays in this browser and is sent to Google's Gemini API in a request header. Never put a key in the source code or commit a backup that includes one.

Install from your browser's Add to Home Screen / Install App menu. The installed app and manifest are named **Coach**. Existing installations may need to be reopened or reinstalled for the launcher name/icon to refresh. Their local database is intentionally still named `moeware`, so the rename preserves existing data on the same origin.

## What changed

- A cream and lilac interface, responsive navigation, accessible controls, conversation starters, and a quieter optional planning area.
- Settings and News preserve independent scroll positions. Mobile viewport/keyboard changes adjust composer placement without scrolling the page. Replies follow the conversation only while you're following it; otherwise a New reply button appears.
- Coach responds to what you say. Venting, questions, wins, and casual conversation no longer require a task recap. Daily planning is requested, never an automatic API call at launch. Add voice preferences in Settings.
- Gemini receives native `update_coach` and `read_news` tool definitions. Changes are validated and saved in a transaction; replies show receipts. Tool responses preserve the model's thought signatures. Temporary failures can use the configured fallback chain, but a request that has already used tools is not replayed across models.
- News searches selected public topics, checks headline relevance, filters unwanted words, deduplicates links, limits stories to the last 14 days, and balances categories. With editorial picks enabled and a connected key, Coach selects up to eight worthwhile reads from real candidates and explains its picks. Topic matching offers up to twelve stories without AI; fewer when matches are weak. AI discussion uses real headline links, not generated articles.
- Local semantic memory indexes every saved message, updates its count continuously, deduplicates its queue, reports failures, supports retry, and respects pause. A downloaded model with no conversations shows an explanatory empty state. Imports rebuild vectors against the restored message IDs.
- Task records survive day rollover and reflection. Backup imports are validated before replacement and committed atomically. Backups omit the API key by default.

## Screens

**Chat:** talk to Coach, request a realistic plan, check off tasks, or reflect on the day. Planning only uses actual context; Coach can ask for clarification instead of inventing a schedule. Goal percentages should follow evidence, not elapsed time.

**News:** public interest searches on Hacker News via Algolia, plus your RSS/Atom feeds. Edit topics and headline words to hide in Settings, or ask Coach to change them. Default interests are AI, software, startups, and design; default exclusions reduce crypto, politics, crime, military, and sports headlines. These are editable. News is headline discovery, not full-article reading or a general web browser. The public search corpus limits available coverage; add trusted feeds to broaden it. Feed items must have valid HTTP(S) links and recent dates. Sources that fail show an error instead of a fabricated replacement.

**Settings:** connection, personal context, voice, goals, durable memory, semantic memory, news preferences, transcript search, prompt preview, and backups. Profile and voice are saved explicitly. Background app updates do not replace these drafts.

## Memory and privacy

Messages, task history, goals, facts, the API key, and vectors live in IndexedDB on this device. Changing the hosting origin does **not** transfer browser storage; export a backup before moving hosts. Browser data deletion or an uninstall can remove local data, so keep backups.

Each Gemini request includes your profile, voice preferences, goals, durable facts, latest summary, today's tasks, a recent transcript, and a few relevant archived excerpts. It does not send the whole archive. Older conversations are summarized in bounded batches; raw messages remain available.

Optional semantic memory loads `Xenova/all-MiniLM-L6-v2` through pinned Transformers.js 2.17.2. Model/runtime files are downloaded from jsDelivr and Hugging Face and browser-cached when possible. Inference and vectors stay on-device. Storage pressure or browser cache eviction can require another download. WASM inference is serialized so retrieval and background indexing do not collide. Keyword search works while memory is paused or unavailable.

News sends only saved public topics and feed URLs to the source services; it does not turn private goals or conversations into queries. Optional editorial curation sends fetched headlines and your reading preferences to Gemini, without private chat, profile, or goal context. Results are cached for fifteen minutes; a manual refresh can make a new curation request. Curation failures fall back to labelled topic matches rather than made-up articles. RSS is read directly by default. The optional AllOrigins proxy sends the feed URL to that third party. Gemini, news, and embedding downloads require network access; the app shell and stored data are available offline.

Backups contain private conversations and memories even without a key. Including a key is an explicit checkbox. Existing Moeware-format backups are accepted when their structure is valid. Imports replace the local archive after an in-app confirmation. A wipe clears this app's stores and its legacy storage key, not unrelated storage on the origin.

## Verification

```sh
node --check app.js
node --check sw.js
node --test tests/coach.test.cjs
```

The regression suite uses a small transaction-aware storage fixture and mocked Gemini/news responses. It covers scroll isolation, double-send prevention, tool validation and round trips, atomic updates/restores, fallback behavior, indexing and pause, news filtering, rollover, and archive preservation. It does not claim to validate Google's live model output or every browser's IndexedDB behavior. Real provider testing needs an API key in the browser; no credentials are bundled.

The PWA caches the app shell, fetches fresh files when online, and offers an update button for a waiting worker. Accepting an update reloads only after the new worker takes control. It leaves embedding download caches and unrelated origin caches alone.

API references: [Gemini function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling), [Transformers.js pipelines](https://huggingface.co/docs/transformers.js/v2.17.2/pipelines).
