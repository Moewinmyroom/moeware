# Wrinkle Coach

## Make it yours

The interface uses warm cream, moss, charcoal, and mustard, with **Chat**, **Reads**, **My stuff**, and **Lounge** in the navigation. Settings and a light/dark toggle are in the header. The theme follows your system until you choose one; that choice is remembered on this device and applied before the first paint. Goals, saved memories, your profile, and history search live in My stuff.

- **Editable master prompt:** Settings opens with a short personality prompt. The default is a candid, playful friend: “one of the girlies,” without turning every conversation into homework. Save any replacement, including an empty prompt, or restore the default. Separate, visible app-mechanics instructions explain tools and factual bookkeeping. Existing extra voice preferences still apply. Prompt changes affect subsequent replies and survive backups.
- **Reads:** The suggested interests are newsletters, founders, small business, marketing, and using AI. Edit up to twelve topics, exclusions, reading taste, and RSS/Atom feeds. Existing custom interests are retained; the previous stock software-interest list migrates to the new suggestions. Hacker News is optional and off by default. “Use suggested mix” fills the form without overwriting saved preferences until Save is clicked.
- **Find fresh reads:** A user-triggered Gemini request uses Google Search grounding for recent coverage of saved interests and followed names. It sends reading preferences and names, not your chat, profile, goals, persona notes, or memories. Results require source metadata, show citations and source links, and display Google's search suggestions in a sandboxed frame. Search may incur provider charges. No automatic/background web roundup runs, and a failed/unsupported provider response is shown honestly. RSS remains a separate source; private email newsletters and social accounts are not connected.
- **Lounge:** Add the business people whose work interests you and optional notes about the perspective you want. Each gets a clearly labeled fictional AI conversation, inspired by public work and your notes, with no claim to real opinions or endorsement. The latest 40 messages from that person's chat go to Gemini. These chats do not use or update Wrinkle Coach's ordinary memories, commitments, or history and have no live web access. Names also inform your next reading roundup. All fictional history remains in backups until deleted.
- **Context controls:** Settings lets you delete selected categories or reset all personal context while preserving your key, master prompt, reading mix, and people definitions. Chat deletion can be limited to an inclusive local date range and also removes saved records linked to deleted messages. Every deletion clears episode summaries, vector indexes, today's focus, and local recovery snapshots, and disconnects automatic folder backups. Surviving chat history can be reindexed/summarized later. Removing saved memories alone does not erase mentions in retained conversations. Exported files are outside the deletion scope. “Wipe this device” also resets credentials and preferences. Destructive actions require an in-app confirmation and commit atomically.

The regression suite includes prompt persistence, fictional-chat isolation, grounded-news provenance and privacy, selective/full context deletion, failed-write recovery, and stale/in-flight summary protection. Desktop and phone layouts were checked in the browser; live Gemini/search output still needs verification with a valid API key.

A personal Gemini assistant that keeps the bigger picture and helps you focus on today. Talk throughout the day about changes, projects, deadlines, and completed work. Each morning, ask “What do I absolutely have to do today?” or use **What matters today?**

## Run

Installed-app updates use a versioned, consistent app-shell cache. Recovery and update buttons initialize independently of saved data, so an old open tab blocking a database upgrade no longer leaves a silently unresponsive screen. On Android, close other app windows and Chrome tabs for this app, reopen while online, and use **Update & reload** when offered. Do not clear site data: that would erase browser-local conversations. The renamed app keeps the existing manifest ID, scope, and `moeware` database.

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. Use HTTPS when hosting. Save your Gemini API key in Settings. No build step, server account, or analytics. Install through your browser's Install App / Add to Home Screen menu.

## Daily focus

Wrinkle Coach keeps a persistent backlog of commitments. Tasks support deadlines, not-before dates, estimated minutes, priority, blockers, consequences, completion history, and goal links. Unfinished work survives day changes. Cancelled commitments remain in history.

The chat screen shows only the selected daily focus and work completed today. Normally Wrinkle Coach selects one main priority and at most two other necessary actions, explains why each matters today, and distinguishes genuine obligations from optional progress. It considers future deadlines internally, including preparation needed today, without presenting a weekly roadmap. It should say when nothing is truly urgent. Morning greetings and daily-focus requests work directly in chat. Planning is never an automatic API request at launch.

During the day, report completions, constraints, and new commitments naturally. Wrinkle Coach saves supported updates with native Gemini tools and visible receipts. Use **Later** to remove an item from today's focus while keeping the commitment. The full backlog is available in My stuff when you want to inspect it.

Goals can hold project notes, next actions, blockers, horizons, and milestones. When milestones exist, progress is calculated from completed milestones. Without milestones, percentages are user-reported rather than an estimate of success or schedule health. Deadlines are local calendar dates, not appointment times.

Prioritization and extracting commitments still require model judgment. The app validates data, IDs, dates, and selection eligibility; it cannot prove that every model-generated priority is correct. If essential information is missing, Wrinkle Coach should ask one focused question instead of inventing an obligation.

## Memory

- The latest 24 messages are included in full. Messages awaiting summarization also stay in context, closing the gap between the recent window and archived memory.
- Older exchanges become independent dated episodes, normally up to 20 messages per batch. Episodes retain decisions, reasons, constraints, and speaker attribution. A year is not repeatedly compressed into one tiny rolling paragraph. Raw transcripts are preserved.
- Episode creation and marking covered messages commit together. Maintenance failures appear in Settings with a retry action; failed episodes do not disappear from working context. Very large unsummarized backlogs stop a request with an explicit maintenance instruction instead of silently dropping history.
- Durable memory uses IDs, stable keys, project scopes, dates, and conversation source references. Corrections retire the old version; forgetting retires an active memory. There is no sixty-fact eviction limit. Forgetting a durable memory does not erase the raw conversation or backups; historical claims are explicitly marked as superseded/forgotten in context.
- Retrieval includes neighboring exchanges and relevant dated episodes. Vague follow-up questions use recent user context to help identify the subject. Wrinkle Coach can call `search_memory` itself, including date-limited searches, when automatic retrieval is insufficient.
- Optional semantic search runs `Xenova/all-MiniLM-L6-v2` locally through pinned Transformers.js 2.17.2. Downloads come from jsDelivr and Hugging Face. Keyword search remains available while semantic indexing is paused or unavailable.

Older databases and validated Moeware/Wrinkle Coach backups are migrated without deleting task history. Existing rolling summaries remain available as historical records; originals can still be searched. Multiple tabs use revision checks to prevent stale state overwriting a newer saved task/memory update.

## Storage and recovery

Messages, goals, tasks, memories, API credentials, vectors, and episode summaries live in IndexedDB in this browser. The database remains named `moeware` for compatibility. Only the light/dark appearance preference uses localStorage; it is not part of exported backups. Gemini requests send the selected private context to Google; local storage does not mean AI requests stay on-device.

Automatic recovery snapshots retain the last seven active days in the same browser. These help recover accidental changes but share the browser's storage and do not survive deletion of that storage. In Settings → Data, export an independent backup or connect an automatic backup folder in a browser supporting the File System Access API. Folder access is user-selected, must remain authorized, and only writes while the app is running. Folder backups use one file per active local day. Reconnect if browser permissions expire. Backups contain private conversations; automatic snapshots and folder backups omit the API key.

Manual exports omit the key unless explicitly selected. Backup import/restore is validated and atomic. The current Gemini key is preserved when a backup omits it. Changing hosting origin does not transfer storage: export before moving. Wiping the device clears all app stores, including recovery snapshots, after confirmation.

The app shell works offline; AI replies require a connection. Automatic memory maintenance makes additional Gemini requests as older conversations accumulate. Usage is not currently metered in the app.

## News

Reads combines an on-demand Google Search roundup with user-provided RSS/Atom feeds and optional Hacker News matches via Algolia. Public interests and feed URLs go to the source services, not private chat or goal-derived searches. Optional Gemini headline curation sends headline candidates and reading preferences without private profile/chat/goal context. Feed stories are filtered, deduplicated, and cached for fifteen minutes. Failures produce labelled fallbacks or source errors, not invented articles. RSS reads directly by default; an optional AllOrigins proxy is explicitly enabled in the reading mix.

## Current boundaries

This is a browser-local assistant. It does not yet have calendar access, cross-device sync, scheduled background notifications, arbitrary document access, or a microphone/voice conversation interface. It can update its own commitments and memory and read headlines. Those external capabilities require separate integrations. The daily workflow is conversational and starts when you talk to Wrinkle Coach each morning.

The default tone follows the user's request for “one of the girlies”; personality is editable in Settings. Fictional business personas are separate from that everyday voice.

## Verification

```sh
node --check app.js
node --check sw.js
node --check startup.js
node --test tests/coach.test.cjs tests/startup.test.cjs
```

The suite uses transaction-aware storage fixtures and mocked Gemini/news responses. It covers daily focus and persistent backlog, stable-ID updates, date validation, blockers, correction/forgetting, provenance, milestone progress, context continuity, atomic episodic memory, stale-tab conflicts, backup recovery, native tool round trips, fallback, and existing news/indexing/scroll behavior. Live Gemini output and browser-specific storage/permission behavior require separate provider/browser checks.

References: [Gemini function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling), [Google Search grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search), [Transformers.js pipelines](https://huggingface.co/docs/transformers.js/v2.17.2/pipelines).
