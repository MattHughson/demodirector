# Demo Director

Stage-manage live product demos from a Stream Deck: hide parts of the page and reveal them on cue, show a camera bubble, topic lower-thirds and a fake Slack notification, and see the whole board on a second screen.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Extension core: veils, element picker, Rehearse/Live, badge, hotkeys, export/import | ✅ done |
| 2 | Camera bubble (device picker, on/off, blink, S/M/L), 10 topic lower-thirds, Slack notification | next |
| 3 | Director console (second-screen window) | |
| 4 | Stream Deck plugin (native, WebSocket bridge, live key states) | |
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

## Modes

- **Rehearse**: picker enabled, a small chip on the page, grey badge.
- **Live**: no editing UI drawn in the page, red badge.

The badge number is how many veils are on, so you know the state before going live.

## Shortcuts (fallback when the Stream Deck plugin isn't running)

| Default (Mac) | Action |
|---|---|
| ⌃⇧1 / ⌃⇧2 / ⌃⇧3 | Toggle veil in slot 1 / 2 / 3 |
| ⌃⇧0 | Reset (all veils on) |
| unbound | Veils 4–6, Rehearse/Live, start picker |

Chrome only allows 4 suggested keys per extension. Bind the rest in `chrome://extensions/shortcuts`. Slot numbers are the veil order on the settings page.

## Architecture

`background.js` is the command bus. Every input (hotkeys, popup, settings, the picker, and later the console and Stream Deck) sends an action to `dispatch()`. Actions are serialised so rapid key presses can't race, and state changes are broadcast to pages and the badge.
