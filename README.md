# Moeware — private daily coach (PWA)

A calm, Japandi-styled planner that ranks your day, tracks long-term goals, and doubles as a coach. Built for an AuDHD CEO who wants the heavy thinking done in the background.

Local-first. Your Gemini key and all data stay in your phone's browser (localStorage). Nothing is committed to git.

## Where the API key goes (read this)

**Do not put the key in the code.** This is a static site — anything in the files is visible to anyone who can open the page, and the deployed GitHub Pages URL is not truly private. Instead:

1. Get a key at https://aistudio.google.com/apikey
2. Open the app → **Setup** tab → paste it into **Gemini API key** → **Save**.
3. It is stored only in that browser's localStorage on that device. It is sent only to Google, only when you use the coach.

That's it. No file editing, no rebuild. (If you ever see a `Setup` banner on the Today tab, you haven't saved a key yet.)

**Model note:** there is no `gemini-3.8-flash`. The free key works with e.g. `gemini-2.5-flash` (default), `gemini-2.5-flash-lite` (cheapest), `gemini-2.0-flash`, `gemini-2.5-pro`. The Model field is editable — type any model name you have access to.

## Run locally
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
Opening `index.html` directly works too; a server is better for installing the PWA.

## Free private-ish hosting
1. Push to a **private** GitHub repo.
2. Settings → Pages → Deploy from branch → `main` / root.
   - Free GitHub Pages serves the *code* publicly (obscure URL). That is fine here because **no data or key lives on the server** — they live in your phone's localStorage. Never commit the key.
3. Phone: Share → Add to Home Screen (iOS) or ⋮ → Install app (Android).
4. Open the app → **Setup** → paste key → add goals in **Goals**.

For a truly access-controlled URL, drop the same files on Cloudflare Pages (free) with Access, or Vercel with password.

## How it maps to the brief
- **Daily check-in:** brain dump → coach ranks by needle-moving (1–10), maps each to a goal, shows the Top 3 first.
- **Long-term tracking + reroute:** Close day → coach updates goal % and proposes a reroute; memory is auto-pruned to the newest 20 facts.
- **News:** plain JavaScript only — searches built from your goals, fetched from Hacker News and Open Library, plus a YouTube search link. No LLM in the fetch path.
- **Master prompt:** rebuilt on every call from local date + project context + goals with % + progress + lean memory. Live preview in Setup.
- **Conversational:** Coach tab is quick chat; the deep reasoning lives in the master prompt.

## Privacy
- Export a backup anytime (Setup → Data → Export). Wipe the device anytime.
- If you lose your phone, revoke the AI Studio key — data was only on-device.
