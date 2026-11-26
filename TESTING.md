# Demo Director: manual test script

This script is for a browser agent (Claude in Chrome) working with Matt. Go through the sections in order. For each test, do the steps, compare what you see with **Expected**, and record PASS, FAIL or BLOCKED. For anything other than PASS, add a one-line note and take a screenshot.

Steps marked **[MATT]** need a human, for example a Chrome permission prompt, a keyboard shortcut or a physical device. Ask Matt to do them, then check the result yourself.

---

## 0. Setup (Matt fills in)

| Placeholder | Value |
|---|---|
| `<EXT>`: extension ID, from `chrome://extensions` → Demo Director → ID | |
| `<STUDIO>`: Studio Drops list URL, e.g. `http://localhost:3333/structure/drops` | |
| `<STORE>`: storefront URL | |

Useful pages (open them in a tab):

- Settings: `chrome-extension://<EXT>/options.html`
- Director console: `chrome-extension://<EXT>/console.html`. Matt normally opens this as its own window from Settings → **Open Director console**.

**Ground rules**

- Never use **Reset demo**, **Rebuild tabs now** or ⌃⇧0 until section 7. They close tabs.
- All on-page UI (the Rehearse chip, picker, camera bubble, lower-third and Slack post) is drawn inside a closed shadow root. You can't query it with selectors, so check it with screenshots.
- **[MATT]** Before starting: `git pull`, reload the extension in `chrome://extensions`, then reload every Studio and storefront tab.

---

## 1. Install and basics

| ID | Steps | Expected |
|---|---|---|
| 1.1 | Open `<STUDIO>`. | A dark pill appears bottom-left: `REHEARSE · N veils on`. Nothing else from the extension is visible. |
| 1.2 | Open Settings. | The page shows these sections: Veils, Demo tabs, Camera bubble, Topics (lower-thirds), Slack notification, Back up and share, Keyboard shortcuts. There are no console errors. |
| 1.3 | In Settings, click **Live**, then **Rehearse**. | The segmented switch follows. In Live the chip on the Studio tab disappears, and in Rehearse it comes back. |

## 2. Veils (the picker on the real Studio)

| ID | Steps | Expected |
|---|---|---|
| 2.1 | On `<STUDIO>` (Rehearse mode), click the bottom-left `REHEARSE` chip. | A dark bar appears top-centre: "Pick an element to veil…". Moving the mouse highlights elements in orange. |
| 2.2 | Hover the **date/status subtitle** on one Drops row and click. | A "New veil" panel opens bottom-right. "Same spot in each" is selected. Dashed outlines appear on the subtitle of **every** row, and on nothing else. The count reads "N elements will be hidden", where N is the number of rows. |
| 2.3 | Type `dates` in Name and press Enter. | The panel closes and every row's date/status subtitle disappears. Titles and the rest of each row stay. The chip shows `1 veil on`. |
| 2.4 | Click the chip again. Click the **Live** folder item, then **+ Add another**, then click **Upcoming**, **+ Add another**, then **Past**. Name it `folders` and save. | Live, Upcoming and Past disappear. **"All drops" stays visible.** The chip shows `2 veils on`. |
| 2.5 | Open Settings → Veils. Copy both veils' selector text into your report. | Slot 1 is `dates` and slot 2 is `folders`, both showing **Hidden**. |
| 2.6 | In Settings, click `dates`' **Hidden** button. Switch to the Studio tab. | The dates are back immediately, with no page reload. |
| 2.7 | Reload the Studio tab. | The dates are still visible and the folders still hidden. The state survives the reload. |
| 2.8 | Click around the Studio: open a drop, go back to the list, scroll. | The veils keep holding. Nothing flickers back. |
| 2.10 | Start the picker, click a date subtitle, and set **Only hide if the text** to **looks like a date**. | Only date-bearing subtitles are outlined, never titles. The count drops to match. Save it as `dates2`. Those dates vanish and the titles stay, including after clicking around. |
| 2.11 | Settings → Veils → `dates2`: change the filter to **starts with** `Dec`. | Only subtitles starting with "Dec" are hidden. Set it back to **(any text)** and the plain selector applies again. |
| 2.9 | **[MATT]** Press ⌃⇧1, then ⌃⇧2. | Each press toggles dates, then folders, instantly. |

## 3. Director console

| ID | Steps | Expected |
|---|---|---|
| 3.1 | Open the console. | It's a dark page with Camera, Veils, Slack post (left) and Tabs, Topic (right). The header shows REHEARSE and "Stream Deck: not connected". |
| 3.2 | Click the `dates` row in the console. | It flips between HIDDEN and SHOWN, and the Studio tab matches. |
| 3.3 | Click the **REHEARSE** header button. | It turns into a red pulsing **LIVE**. The Studio chip disappears and the toolbar badge turns red. Click it again to go back to Rehearse. |

## 4. Camera bubble

| ID | Steps | Expected |
|---|---|---|
| 4.1 | **[MATT]** Settings → Camera bubble → **Grant camera access** and allow the prompt. Choose the webcam and click **Preview**. | The round preview shows Matt and is mirrored. The button reads "Camera access granted ✓". Click **Stop preview**. |
| 4.2 | Console → Camera **On / off**. Look at the Studio tab. | A round bubble with Matt's camera appears top-right, at the medium size (240px). **No new permission prompt appears.** If one does, report it as FAIL. |
| 4.3 | Console → camera size button, three times. | The bubble cycles through S, M and L. Each change is visible within about half a second. |
| 4.4 | Settings → Blink every = `5`. Console → **Blink**. Watch for 15 seconds. | The bubble fades out and in every 5 seconds. The console shows "Blinking · visible/hidden" with a countdown. |
| 4.5 | Turn Blink off, then the camera off. | The bubble disappears and the camera light turns off. |

## 5. Topics (lower-thirds)

| ID | Steps | Expected |
|---|---|---|
| 5.1 | Console → **Next ▶**. | Bottom-left of the Studio tab, a dark bar slides in reading "STEP 1 · Click what you see" with an orange icon. |
| 5.2 | **Next ▶** twice more, then **◀ Prev**. | It shows Step 2, then Step 3, then Step 2 again ("Status from dates", calendar icon). |
| 5.3 | Click topic **7** in the console list. | The bar shows "Step 7 · Rules that stop bad launches" (shield icon). |
| 5.4 | Console → **Show / hide**. | The bar slides away. The console shows "Step 7 · hidden". |
| 5.5 | Settings → Topics, change topic 1's title. Show topic 1. | The new title appears on the page. |

## 6. Slack notification

| ID | Steps | Expected |
|---|---|---|
| 6.1 | **[MATT]** Settings → Slack notification → **Upload avatar…** and pick Nancy's photo. | The avatar preview updates. |
| 6.2 | Turn the camera on (M). Console → Slack post row. | A white card slides in from the right, top-right of the page, **below the camera bubble** with no overlap. It shows the avatar, "#drops · Marlowe & Finch", **Nancy**, "now", and the message. It doesn't cover the Studio's **+** (create) button. |
| 6.3 | Click the card on the page. | It slides out and the console shows HIDDEN. |
| 6.4 | Tick **Chime**, then show it again. | **[MATT]** confirms a short two-note chime plays. |
| 6.5 | Set Auto-hide to `4`, then show it. | It dismisses itself after about 4 seconds. Set Auto-hide back to `0`. |

## 7. Demo tabs and Reset demo (this closes tabs)

Before this section, open Settings and the console as **their own windows**, not as tabs in the demo window. Otherwise Reset will close them.

| ID | Steps | Expected |
|---|---|---|
| 7.1 | Settings → Demo tabs: add `Studio` → `<STUDIO>` and `Storefront` → `<STORE>`. | Both rows are saved. The storefront row shows an **Allow** button (the Studio row doesn't). |
| 7.2 | **[MATT]** Click **Allow** on the storefront row and accept Chrome's prompt. | The Allow button disappears. |
| 7.3 | Reload the storefront tab. | The `REHEARSE` chip appears bottom-left on the storefront, and the veils, camera, topic and Slack post also work there. |
| 7.4 | In the demo window, open 3 extra tabs (any sites), and navigate the Studio tab into a drop. | The console's Tabs card shows Studio and Storefront, plus "3 other tabs open… Reset demo closes them". |
| 7.5 | Reveal both veils, show a topic and show the Slack post. Then console → **Reset demo**. | The demo window has exactly **Studio, Storefront** in that order, with Studio focused and back at `<STUDIO>`. The extra tabs are closed and the console window is still open. Dates and folders are hidden again, and the topic and Slack post are gone. The camera hasn't changed. |
| 7.6 | Console → **Next tab ▶**, then again. | It moves to Storefront, then wraps back to Studio. The console marks the current tab ON SCREEN. |
| 7.7 | Settings: untick "Reset demo also restores these tabs", open an extra tab, and Reset. | The extra tab stays open, but the stage still resets. Tick the box again. |

## 7b. Segments (run-of-show)

| ID | Steps | Expected |
|---|---|---|
| 7b.1 | Settings → Segments: for Studio set Camera on arrival = **On**, time `0:30` and two lines of talking points. For Storefront set Camera = **Off** and time `1:00`. | The header shows "Planned total: 1:30". |
| 7b.2 | Rehearse mode. Switch to the Studio tab and drag the camera bubble to the bottom-left. Drag its orange handle to make it bigger. | It follows the mouse, snaps to that corner and stays there. Settings shows "Camera spot: ↙ bottom-left · NNNpx". |
| 7b.3 | Switch to Storefront, then back to Studio. | Storefront: the camera goes off. Studio: the camera comes back on at the dragged spot and size. |
| 7b.4 | Watch the console for 30+ seconds on Studio. | The Now card shows "Segment 1 / 2 · Studio" with the talking points. The timer counts up and turns amber at 0:24, then red after 0:30. The Run of show row matches. |
| 7b.5 | Go **Live**. | The header clock starts. Dragging the bubble does nothing. |
| 7b.6 | **Reset demo**. | All segment timers go back to 0:00, and the clock restarts. |

## 8. Backup

| ID | Steps | Expected |
|---|---|---|
| 8.1 | Settings → **Export JSON**. | `demo-director.json` downloads and contains `veils`, `settings` and `avatar`. |
| 8.2 | Delete the `folders` veil, then **Import JSON…** the file. | `folders` is back. |

---

## 9. Slides and speaker notes

| ID | Steps | Expected |
|---|---|---|
| 9.1 | Settings → Slides & speaker notes: paste the deck's **editor** link and click **Load notes from Google**. **[MATT]** Accept Chrome's Google access prompt. | The status reads "Loaded N slides (M with notes) · … · from Google". "Show slides and notes" lists every slide's title and notes. If it fails, note the error and try **Upload .pptx instead**. |
| 9.2 | Add the deck as a demo tab and open it (Present mode or the published link). Look at the console. | The header pill turns orange: **SLIDES MODE**. Notes for the current slide fill the left side, and Now/Next previews appear on the right. |
| 9.3 | **[MATT]** Advance the deck with the arrow keys or a clicker, a few slides forward and one back. | The slide number, title, notes and previews follow within about half a second each time. |
| 9.4 | Switch to the Studio tab. | The console goes back to **DEMO MODE** (camera, veils, tabs, topics). Switching back to the deck returns to the notes. |
| 9.5 | On the deck tab, click **Demo controls**, then **Back to notes**. Try **A+ / A−**. | You can peek at the demo controls and come back. The notes text resizes, and the size is remembered after the console reloads. |
| 9.7 | Deck open in the **editor or published** view. Console (Slides mode) → **Next slide ▶** / **◀ Prev slide**. | The deck moves one slide per click without reloading. The notes follow, and it stops at the first and last slide. |
| 9.8 | Deck in **Present** mode → **Next slide ▶**. | The deck advances. If it doesn't, note it as FAIL and say whether the console's notes changed. |
| 9.9 | In Slides mode: **Camera**, **Blink**, **S/M/L** buttons. | The camera bubble responds on the deck tab (published or editor view). The Blink button shows "Hides in Ns" / "Back in Ns". |
| 9.6 | Open any Google **Doc** (not Slides). | No `REHEARSE` chip appears there. Demo Director only runs on Slides pages. |

## Report format

Paste this back to Claude Code:

```
Chrome version:
Studio URL type: localhost / codespace

| ID | Result | Note |
|----|--------|------|
| 1.1 | PASS | |
| 2.2 | FAIL | outlined titles too; N=12 instead of 6 |
...

Selectors generated (2.5):
  dates:   ...
  folders: ...

Console errors (from DevTools on the Studio tab and the Settings page, if any):
...
```
