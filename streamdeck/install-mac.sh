#!/bin/sh
# Install the Demo Director Stream Deck plugin on this Mac by LINKING it from this
# repo, so `git pull` updates it (then just restart the Stream Deck app).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/com.demodirector.streamdeck.sdPlugin"
PLUGINS="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins"
DEST="$PLUGINS/com.demodirector.streamdeck.sdPlugin"

if [ ! -f "$SRC/bin/plugin.js" ]; then
  echo "Missing $SRC/bin/plugin.js. Run 'git pull' (the built plugin is committed)." >&2
  exit 1
fi
mkdir -p "$PLUGINS"
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
  echo "A non-linked copy is already installed at:" >&2
  echo "  $DEST" >&2
  echo "Uninstall it in the Stream Deck app (or delete that folder), then run this again." >&2
  exit 1
fi
ln -sfn "$SRC" "$DEST"
echo "Linked: $DEST → $SRC"

echo "Restarting the Stream Deck app…"
osascript -e 'quit app "Elgato Stream Deck"' >/dev/null 2>&1 || true
sleep 2
open -a "Elgato Stream Deck" || echo "Open the Stream Deck app yourself."
echo "Done. Look for the 'Demo Director' category in the Stream Deck action list."
