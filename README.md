# Demo Director

Stage-manage live product demos from a Stream Deck: hide parts of the page and reveal them on cue, show a camera bubble, topic lower-thirds and a fake Slack notification, and see the whole board on a second screen.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Extension core: veils, element picker, Rehearse/Live, badge, hotkeys, export/import | ✅ done |
| 2 | Camera bubble (device picker, on/off, blink, S/M/L), 10 topic lower-thirds, Slack notification | ✅ done |
| 3 | Director console (second-screen window) | ✅ done |
| 4 | Stream Deck plugin (native, WebSocket bridge, live key states) | next |
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

## Camera bubble

1. Open **Settings → Camera bubble → Grant camera access** once. The permission belongs to the extension, so it works on any codespace URL. Then pick your camera.
2. The bubble shows top-right in S / M / L (sizes are in Settings). **Blink** shows it for N seconds and hides it for N seconds (30 by default, set in Settings).
3. The camera only streams in the visible tab, and turning the bubble off releases the camera.

## Topics (lower-thirds)

The 10 script steps come from `topics.json` and can be edited in Settings (title and icon). They appear bottom-left as *STEP N · Title*. Use **◀ / ▶** to step through them and the topic button to show or hide the current one.

## Slack notification

The defaults are in `slack-toast.json` and can be edited in Settings, where you can also upload the avatar. The post slides in from the top-right and sits below the camera bubble when it's on. Clicking it dismisses it. It stays until dismissed, unless `autoHideSeconds` is set. The optional chime is synthesised in the page, so tab-audio sharing picks it up.

**Reset** turns every veil on and hides the Slack post and the topic. The camera is left as it is.

## Demo tabs and Reset demo

In **Settings → Demo tabs**, list the tabs your demo needs, in order, each with a label and URL. **Use tabs from my window** captures the tabs you have open now.

**Reset demo** (button, ⌃⇧0, or later the Stream Deck) works on your demo window, meaning the last normal browser window you used. It:

- turns every veil on and hides the Slack post and the topic;
- keeps each matching tab and sends it back to its starting URL, and opens any missing ones;
- puts the tabs in your order, closes every other tab in that window, and focuses tab 1.

Other windows and the console are never touched. An empty list never closes anything, and a checkbox turns the tab rebuild off. A tab matches if it's on the same site at or below the URL's path (e.g. `/structure/drops/harbor-line` matches `/structure/drops`).

**Other sites (e.g. the storefront):** Demo Director runs on `localhost:3333` and `*.app.github.dev` out of the box. When you add a demo tab on any other site, Chrome asks for access; you can also click **Allow** on that row. Once allowed, everything (veils, camera, topics, Slack post) works there too.

**Next / previous tab** (shortcuts, console buttons) cycles through the demo tabs only. When screen sharing, share the **window** or **screen**, not a single tab.

## Director console (second screen)

Open it from the popup (**Console**), from Settings, or with the `open-console` shortcut. Drag the window to your second monitor; it reopens in the same place next time, and opening it again just focuses it.

It shows everything live: Rehearse/Live, camera state (with a countdown to the next blink), the current topic with the full list of 10 and a marker on the next one, each veil (HIDDEN or SHOWN), and the Slack post. Each item shows its shortcut, with a dashed outline if it isn't bound yet. Clicking anything triggers it, so the console doubles as a backup for the Stream Deck.

## Modes

- **Rehearse**: picker enabled, a small chip on the page, grey badge.
- **Live**: no editing UI drawn in the page, red badge.

The badge number is how many veils are on, so you know the state before going live.

## Shortcuts (fallback when the Stream Deck plugin isn't running)

| Default (Mac) | Action |
|---|---|
| ⌃⇧1 / ⌃⇧2 / ⌃⇧3 | Toggle veil in slot 1 / 2 / 3 |
| ⌃⇧0 | Reset (all veils on) |
| unbound | Veils 4–6, Rehearse/Live, start picker, camera on/blink/size, topic next/prev/toggle, topics 1–10 |
| bind to ⌃⇧4 | Slack notification show / dismiss |

Chrome only allows 4 suggested keys per extension. Bind the rest in `chrome://extensions/shortcuts`. Slot numbers are the veil order on the settings page.

## Architecture

`background.js` is the command bus. Every input (hotkeys, popup, settings, the picker, and later the console and Stream Deck) sends an action to `dispatch()`. Actions are serialised so rapid key presses can't race, and state changes are broadcast to pages and the badge.
