#!/usr/bin/env bash
#
# Regenerates the README screenshots from the mockups in .preview/.
#
# The mockups are static HTML that link the *shipped* stylesheets, so a UI change
# shows up here without the palette being copied anywhere. They are not the real
# extension: React is not rendered, and Chrome cannot screenshot an extension
# popup unattended. Any structural UI change therefore needs the matching mockup
# updated by hand — check the component named in each file's comments.
#
# Usage: npm run screenshots
set -uo pipefail

cd "$(dirname "$0")/.."
PREVIEW_DIR="$PWD/.preview"
OUT_DIR="$PWD/docs/screenshots"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || true)"
fi
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "Chrome not found. Set CHROME=/path/to/chrome" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# name:width:height — the height is the capture viewport, not the screen's own
# size. Popup screens declare a 520px-tall frame (as index.html does) and are cut
# to fit; Settings scrolls in reality, so it is given room to render in full.
SHOTS="
options-page:434:1200
mount-picker:434:554
secret-browser:434:554
secret-detail:434:554
pm-credentials:434:554
pm-passkeys:434:554
autofill-overlay:700:400
autosave-banner:700:480
passkey-consent:700:480
passkey-chooser:700:440
"

status=0
for shot in $SHOTS; do
  [ -z "$shot" ] && continue
  name="${shot%%:*}"
  rest="${shot#*:}"
  width="${rest%%:*}"
  height="${rest##*:}"

  src="$PREVIEW_DIR/$name.html"
  if [ ! -f "$src" ]; then
    echo "✗ $name — no mockup at .preview/$name.html" >&2
    status=1
    continue
  fi

  # --allow-file-access-from-files: the mockups @import the stylesheets out of
  # src/, which is a cross-directory file:// read Chrome blocks by default.
  # --force-color-profile=srgb keeps the brass palette identical across displays.
  # preferredColorScheme=0 pins dark mode, matching the [data-theme="dark"] the
  # mockups set. Both are needed and they are not redundant: the popup follows
  # [data-theme], while content.css switches on prefers-color-scheme because the
  # content UI follows the host page. Leave one out and the injected dropdown
  # renders its light palette inside the dark screenshots.
  "$CHROME" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --allow-file-access-from-files \
    --force-color-profile=srgb \
    --blink-settings=preferredColorScheme=0 \
    --window-size="$width,$height" \
    --screenshot="$OUT_DIR/$name.png" \
    "$src" >/dev/null 2>&1

  if [ -f "$OUT_DIR/$name.png" ]; then
    echo "✓ $name.png (${width}x${height})"
  else
    echo "✗ $name — Chrome produced no image" >&2
    status=1
  fi
done

exit "$status"
