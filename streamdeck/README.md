# Demo Director: Stream Deck plugin

Native Stream Deck keys for the Demo Director Chrome extension. Each key shows live state: green camera when it's on, orange for hidden veils and topics on air, red LIVE, and amber or red when a segment runs long. A press runs the same action as the console.

```
Stream Deck app ──► plugin (Node, bundled) ──ws://127.0.0.1:47821──► Chrome extension
                    key faces ◄───────────── state on every change ◄──┘
```

The plugin only accepts connections from `chrome-extension://` origins, so a web page can't drive your demo. The extension reconnects by itself whenever either side restarts.

## Requirements

- **Stream Deck app 7.1 or newer** (Help → Check for updates).
- Nothing else. The plugin runs on the Node.js bundled with the Stream Deck app, and the built `bin/plugin.js` is committed.

## Install (Mac): linked, so `git pull` updates it

```sh
cd path/to/demodirector
git pull
sh streamdeck/install-mac.sh
```

The script links `streamdeck/com.demodirector.streamdeck.sdPlugin` into Stream Deck's plugins folder and restarts the app. After that, a `git pull` plus restarting the Stream Deck app picks up changes.

Prefer a one-off installer? `cd streamdeck && npm install && npm run pack` makes `dist/com.demodirector.streamdeck.streamDeckPlugin`, which you can double-click to install. A copy installed that way doesn't update with `git pull`.

## Actions (category "Demo Director")

| Action | Press | Key shows |
|---|---|---|
| **Veil** | Toggle the veil in the slot chosen in the inspector (listed by name) | HIDDEN (orange) / SHOWN, plus the veil's name |
| **Camera** | Bubble on/off | ON (green) / OFF, plus size |
| **Blink** | Blink mode on/off | Countdown: "Hides 22s" / "Back 8s" |
| **Camera size** | S → M → L | Current size (or the dragged px size) |
| **Topic** | Next / Previous / Show-hide current / Show step N (inspector) | Step number and title; ON AIR when shown |
| **Slack post** | Show / dismiss | SHOWING (purple) |
| **Live / Rehearse** | Toggle mode | LIVE (red) / Rehearse |
| **Reset demo** | **Hold ~1 second.** A tap is ignored, so a stray press can't close your tabs. | HOLD… while held, then ✓ |
| **Tab** | Next / previous demo tab (inspector) | The target tab's name, plus the current segment's time against its budget (amber at 80%, red when over) |
| **Slide** | Next / previous Google Slides slide (inspector) | |
| **Console** | Open the Director console | |

If Chrome isn't connected, every key shows **OFFLINE · Chrome?**, and a press shows the ⚠︎ alert.

## Ready-made profile

Once the plugin is installed, double-click **`streamdeck/Demo Director.streamDeckProfile`** in Finder. The Stream Deck app imports it as a profile called *Demo Director*, with the layout below and every key already configured (veil slots, topic modes, directions). Switch to it from the profile menu at the top of the Stream Deck window.

It's built for the **Stream Deck MK.2**. To regenerate it (e.g. after changing the layout in `make-profile.mjs`), run `npm run profile`.

## Suggested MK.2 layout (15 keys)

| | | | | |
|---|---|---|---|---|
| Camera | Blink | Camera size | Live / Rehearse | Reset demo (hold) |
| Topic: Previous | Topic: Show/hide | Topic: Next | Slack post | Console |
| Veil 1 | Veil 2 | Veil 3 | Slide: Next | Tab: Next |

Drag each action from the right-hand list onto a key. For Veil, Topic, Tab and Slide, pick the slot or direction in the inspector below the keys.

## Develop

```sh
cd streamdeck
npm install
npm run build      # bundles src/ → com.demodirector.streamdeck.sdPlugin/bin/plugin.js and draws icons
npm run validate   # Elgato's manifest checks
```

- `src/bridge.js`: the WebSocket server (127.0.0.1, extension origins only, ping every 20s).
- `src/views.js`: each key's face and press action, as plain functions of the extension's state.
- `src/plugin.js`: Stream Deck SDK wiring (repaint on change, 1s tick for timers, hold-to-reset).
- Logs: `com.demodirector.streamdeck.sdPlugin/logs/`.
- Port: 47821. To change it, set `DD_PORT` for the plugin and the same port in the extension's Settings → Stream Deck.
