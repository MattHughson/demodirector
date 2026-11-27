# Demo Director

Stage-manage live product demos from a Stream Deck: hide parts of the page and reveal them on cue, show a camera bubble, topic lower-thirds and a fake Slack notification, and see the whole board on a second screen.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Extension core: veils, element picker, Rehearse/Live, badge, hotkeys, export/import | ✅ done |
| 2 | Camera bubble (device picker, on/off, blink, S/M/L), 10 topic lower-thirds, Slack notification | ✅ done |
| 3 | Director console (second-screen window) | ✅ done |
| 4 | Stream Deck plugin (native, WebSocket bridge, live key states): see [streamdeck/README.md](streamdeck/README.md) | ✅ done |
| later | Fill drop (Sanity patch) | |

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose `extension/`.
2. Open your Studio (`http://localhost:3333/*` or `https://*.app.github.dev/*`). Tabs that were already open get the script injected automatically.

## Veils

A veil works like commenting code out: a named CSS rule that hides whatever its selectors match. Toggling a veil adds or removes `veil-<id>` on `<html>`. The extension never removes the app's nodes, so React re-renders can't bring them back or break. A `MutationObserver` only re-adds our classes if the app resets them.

- **A veil is on by default.** A fresh browser session and **Reset** both start fully veiled.
- **State** (which veils are revealed, and the mode) lives in `chrome.storage.session`, so a Studio reload keeps the stage as you left it.
- **Definitions** live in `chrome.storage.local`. Use **Export / Import JSON** on the settings page to commit them or share them.

### Creating a veil (Rehearse mode)

Click **Pick element** in the toolbar popup, or click the `REHEARSE` chip at the bottom-left of the page. Hover to highlight, use `↑`/`↓` to move to the parent or child, then click. Choose a scope:

- **Same spot in each** (default): e.g. the date subtitle on every row.
- **All like this**: every element of this kind.
- **Just this one**: only the element you clicked.

Selectors prefer `data-testid` / `data-ui` / stable ids over generated class names. Per-row ids such as `pane-item-42` become prefix matches. **+ Add another** adds more elements to the same veil (e.g. Live + Upcoming + Past). The matches are outlined live, and you can edit the selector text before saving.

### Hiding only some text

When the title and the secondary text share the same markup, a selector alone can hide too much. In the New veil panel, **Only hide if the text…** narrows it down:

- **looks like a date**: `Dec 11`, `11 Dec`, `12/11`, `2026-12-11`, `today`, `3 days ago`
- **starts with** / **contains**: e.g. `Dec`. It's pre-filled with the first word of what you clicked and isn't case-sensitive.
- **matches pattern**: a regular expression for anything else.

The live count and outlines update as you type. Matching elements get a `data-dd-veil` marker attribute, which the veil's CSS hides. The markers are re-applied when the app re-renders, and nothing is removed. You can change the filter later in Settings → Veils.

If you want the whole second line of every row gone (dates **and** status-only text), plain **Same spot in each** now pins the position at the right level, so no text filter is needed.

## Camera bubble

1. Open **Settings → Camera bubble → Grant camera access** once. The permission belongs to the extension, so it works on any codespace URL. Then pick your camera.
2. The bubble shows top-right in S / M / L (sizes are in Settings). **Blink** shows it for N seconds and hides it for N seconds (30 by default, set in Settings).
3. The camera only streams in the visible tab, and turning the bubble off releases the camera.

## Topics (lower-thirds)

The 10 script steps come from `topics.json` and can be edited in Settings (title and icon). They appear bottom-left as *STEP N · Title*. Use **◀ / ▶** to step through them and the topic button to show or hide the current one.

**Topics per segment.** In Settings → Segments, each segment has a *Topics in this segment* list: pick the topics you'll cover there, in order, each with a rough time into the segment (m:ss). The Stream Deck's **Topic 1 / 2 / 3** keys then show that segment's topics only. A key counts down (*IN 0:45*), flashes *SHOW NOW* when its time comes, turns orange when it's on air, and dims to *SHOWN* once you've shown it. Times count segment time, the same clock as the segment's budget, so leaving and coming back carries on where you left off. The console shows the same list above the talking points. Reset clears the *shown* marks.

## Slack notification

The defaults are in `slack-toast.json` and can be edited in Settings, where you can also upload the avatar. The post slides in from the top-right and sits below the camera bubble when it's on. Clicking it dismisses it. It stays until dismissed, unless `autoHideSeconds` is set. The optional chime is synthesised in the page, so tab-audio sharing picks it up.

**Reset** turns every veil on and hides the Slack post and the topic. The camera is left as it is.

## Segments (run-of-show)

Each demo tab is a **segment**. In **Settings → Segments**, each one has:

- **Tab:** a label and URL, in order. Reset demo rebuilds exactly these tabs (see below).
- **Camera on arrival:** Keep / On / On + blink / Off. This is applied whenever that tab comes on screen, and the camera buttons still override it until the next segment.
- **Camera delay (s):** for On and On + blink, the bubble stays hidden this long after you arrive, then fades in. Blink starts its cycle when it appears. The camera is already streaming, so there's no lag. Use it so the bubble doesn't jump straight across when you change screens. The console and the Stream Deck Camera key show "Appears in 3s". Pressing Camera or Blink cancels the delay.
- **Background** (Settings → Camera bubble): *Real background*, *Solid colour* (pick the colour) or *Blur*. It replaces the room behind you live, using Google's MediaPipe person segmentation bundled in `extension/vendor/mediapipe`. It runs on your Mac and nothing is uploaded. **Preview** in Settings shows the result.
- **Ring colour / width** (Settings → Camera bubble) set the frame around the bubble; width 0 removes it.
- **Camera spot:** open the tab in **Rehearse** mode and drag the bubble where you want it. Resize it from its orange handle. It snaps to the nearest corner and saves to that segment. **Reset spot** in Settings returns it to the default. Dragging is locked in Live.
- **Time budget:** `m:ss` or minutes.
- **Talking points:** what to say and do on this screen. A rich-text box with **bold**, *italic*, underline, highlight, bulleted and numbered lists. Typing `- ` or `1. ` at the start of a line starts a list, and ⌘B / ⌘I / ⌘U work. Pasted text comes in plain. The console shows the formatting.

In the console, the **Now** card shows the current segment's talking points and its timer against the budget. The timer turns amber at 80% and red when over. **Run of show** shows the segment you're on and the next one. Time counts only while a segment's tab is on screen and adds up across visits.

**Show clock.** Going Live doesn't start the clock, because you may be sharing for a while before the meeting really begins. Press **▶ Start clock** in the console header (or the Deck's *Show clock* key, which flashes while you're Live and it hasn't started). That zeroes the show clock, every segment timer and the topic *shown* marks, and starts timing from that moment. It also counts as arriving on the segment you're on, so its camera preset and arrival delay start again from the moment you press Start. After that, a tap **pauses** it and another tap resumes. While paused, the segment timer stops too, and the console shows your total time against the plan up to that point (*ahead* / *behind*). That's handy in rehearsal to check your pace. To restart from 0:00, click **↺** twice in the console or hold the Deck key for 1s. **Reset demo** stops it.

**Arcs and pauses.** In Settings → Segments, **+ Add pause** puts a pause entry in the run of show, marking the end of an arc. Each pause shows its arc's planned time and the running total, and has its own **talking points** (e.g. "Take questions, then share the Studio tab"). When you move forward past a pause (for example, End share closes the slides tab and lands you on the first segment of the next arc), the show clock pauses by itself. The console then treats the pause as the step you're on: the big card shows the pause's name and talking points, with your time against the plan, and the run of show lists the pause as *Now* and the segment on screen as *Next*. The Deck's **Resume** key flashes the pause name and the segment that's waiting. Once you've re-shared the tab in Meet, press Resume. It doesn't switch tabs. It ends the pause, starts the show clock and that segment's timer, and runs its camera preset, so the arrival delay counts from Resume, not from when you landed on the tab. (The clock key, or the console's clock button, also resumes.) The extension can't start the Meet share for you: Meet needs its own Share click.

**Runs (review).** Every run of the show clock is saved, from **Start clock** until **Reset demo** or the next Start, tagged *Rehearse* or *Live*. Settings → **Runs** shows each run: how long every segment and arc took against its budget, which planned topics you showed (and how far into the segment, against the planned time) or missed, whether the Slack post went out, and a timeline of everything you did (segments, topics, Slack, veils, camera, pauses, mode). To have a missed Slack post flagged, tick **Slack post: planned here** on that segment. In the segment list, each time budget shows the last run and the average next to it. Your budgets are never changed. The last 30 runs are kept.

**Google Meet.** **New Meet** in the console header starts an instant meeting (meet.new) in its own window, or brings your call back to the front if it's already open. Keeping Meet in its own window means Reset demo never closes it. Demo Director also never treats a window that only holds Meet as the demo window, so clicking Share in Meet doesn't make End share or Next tab act on the call. To rehearse with a recording and transcript, start a Meet on your own, share the demo window, and record with transcription on (it depends on your Workspace plan).

**Split-view segments.** A segment can have a second page beside it, e.g. GitHub with Studio still on screen. In Settings → Segments, fill in **Split with** with the second pane's URL. Both panes count as that segment, so clicking from one pane into the other doesn't switch segments or reset timers. **Reset demo** reopens both panes, and on Chrome 155+ puts them back into a split view. On older Chrome it leaves them as two tabs next to each other, and the console's run of show marks the segment *NOT SPLIT* until you select both and choose *Split view*. Veils work in both panes. The camera bubble, topic and Slack post appear in one pane only (**Overlays in**: main or split pane). **Close tab** on a split segment closes both panes. Share the window, not a tab, for a split segment: a single-tab share shows just one pane.

**Close tab to end a share.** If you share a single tab in Google Meet, closing that tab ends the share. So on a slides segment, the Deck's **Close tab** key reads *END SHARE*, and a normal press closes the tab and lands you on the next segment, ready to share that. On other segments it's *CLOSE TAB* and needs a ½s hold, so a bumped key can't close your demo.

**Next tab** follows the run of show from the segment you're on, even if that tab's address has changed since (logging in, clicking around, a deck in Present mode). It stops at the last segment rather than wrapping back to the first, and opens a segment's tab if it isn't open. On the Google Slides segment, the console shows the deck's speaker notes instead of talking points, with the segment timer beside the slide number.

## Demo tabs and Reset demo

In **Settings → Demo tabs**, list the tabs your demo needs, in order, each with a label and URL. **Use tabs from my window** captures the tabs you have open now.

**Reset demo** (button, ⌃⇧0, or later the Stream Deck) works on your demo window, meaning the last normal browser window you used. It:

- turns every veil on and hides the Slack post and the topic;
- keeps each matching tab and sends it back to its starting URL, and opens any missing ones;
- puts the tabs in your order, closes every other tab in that window, and focuses tab 1.

Other windows and the console are never touched. An empty list never closes anything, and a checkbox turns the tab rebuild off. A tab matches if it's on the same site at or below the URL's path (e.g. `/structure/drops/harbor-line` matches `/structure/drops`).

**Pages inside frames (e.g. a Studio in the Sanity dashboard):** Demo Director runs inside frames too, so veils and the picker work on a Studio the dashboard shows in an iframe. The camera, topic and Slack post still draw once, on the top page. If the frame's site isn't allowed yet, the picker says *Inside a frame from …*. Click the Demo Director toolbar button, press **Allow**, reload the page and pick again. In the picker, **↓** goes into the child under your mouse and **← / →** step between siblings.

**Other sites (e.g. the storefront):** Demo Director runs on `localhost:3333` and `*.app.github.dev` out of the box. When you add a demo tab on any other site, Chrome asks for access; you can also click **Allow** on that row. Once allowed, everything (veils, camera, topics, Slack post) works there too.

**Next / previous tab** (shortcuts, console buttons) cycles through the demo tabs only. When screen sharing, share the **window** or **screen**, not a single tab.

## Director console (second screen)

Open it from the popup (**Console**), from Settings, or with the `open-console` shortcut. Drag the window to your second monitor; it reopens in the same place next time, and opening it again just focuses it.

It shows everything live: Rehearse/Live, the segment you're on with its timer, planned topics and talking points, camera state (with a countdown to the next blink), the run of show (just the segment you're on and the next one, with Next tab and Close tab), each veil (HIDDEN or SHOWN), and the Slack post. The full topic list is folded away under *All topics* for anything you didn't plan. Each item shows its shortcut, with a dashed outline if it isn't bound yet. Clicking anything triggers it, so the console doubles as a backup for the Stream Deck.

## Slides and speaker notes

1. Add your Google Slides deck as a demo tab. Present mode, the published view and the editor all work.
2. In **Settings → Slides & speaker notes**, paste the deck's editor link and click **Load notes from Google**. Chrome asks once for Google access. The deck is downloaded as .pptx with your own Google login and read locally. If that fails, use **Upload .pptx instead** (in Slides: File → Download → Microsoft PowerPoint).
3. When the deck's tab is on screen, the console switches to **Slides mode**: big notes for the current slide, the slide number and title, and previews of the current and next slide. **A− / A+** resize the notes, and **Demo controls** lets you peek at the demo controls. Switch to any other tab and it's back to **Demo mode**.

Slides mode also has its own controls: **◀ Prev slide / Next slide ▶** and **Camera on/off, Blink (with countdown), S/M/L**, so you don't have to leave the notes. Shortcuts: `slide-next` / `slide-prev`.

- **Editor or published view:** the buttons jump the deck by changing only the `#slide=` part of the URL. No reload, clamped at the first and last slide. This needs the notes loaded.
- **Present mode:** the buttons press ←/→ inside the deck. This is best-effort, so if Present mode ignores it, use the published view.

You can still advance the deck yourself (clicker, arrow keys or a Stream Deck hotkey). The notes follow the slide named in the tab's URL (`slide=id.<pageId>`). Edited the deck? Click **Load notes** again. Google access only adds Demo Director to Slides pages, never the rest of Docs or Drive.

## Modes

- **Rehearse**: picker enabled, a small chip on the page, grey badge.
- **Live**: no editing UI drawn in the page, red badge.

The badge number is how many veils are on, so you know the state before going live.

## Shortcuts (fallback when the Stream Deck plugin isn't running)

| Default (Mac) | Action |
|---|---|
| ⌃⇧1 / ⌃⇧2 / ⌃⇧3 | Toggle veil in slot 1 / 2 / 3 |
| ⌃⇧0 | Reset (all veils on) |
| unbound | Veils 4–6, Rehearse/Live, start picker, camera on/blink/size, topic next/prev/toggle, topics 1–10, close tab |
| bind to ⌃⇧4 | Slack notification show / dismiss |

Chrome only allows 4 suggested keys per extension. Bind the rest in `chrome://extensions/shortcuts`. Slot numbers are the veil order on the settings page.

## Architecture

`background.js` is the command bus. Every input (hotkeys, popup, settings, the picker, and later the console and Stream Deck) sends an action to `dispatch()`. Actions are serialised so rapid key presses can't race, and state changes are broadcast to pages and the badge.
