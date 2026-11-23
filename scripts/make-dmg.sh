#!/usr/bin/env bash
# Signed + notarized release DMG: tauri build (.app, Developer ID, hardened runtime) → notarize + staple app → hdiutil DMG → sign, notarize + staple DMG → Gatekeeper check.
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Joshua Glazer (PWGXN26URQ)}"
PROFILE="${NOTARY_PROFILE:-notarytool}"
VERSION=$(node -p "require('$ROOT/apps/devtex/src-tauri/tauri.conf.json').version")
BUNDLE="$ROOT/target/release/bundle"
APP="$BUNDLE/macos/DevTex.app"
OUTDIR="$BUNDLE/dmg"
DMG="$OUTDIR/DevTex_${VERSION}_aarch64.dmg"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Building DevTex $VERSION (.app, signed with $IDENTITY)"
(cd "$ROOT/apps/devtex" && APPLE_SIGNING_IDENTITY="$IDENTITY" pnpm tauri build --bundles app)
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> Notarizing app"
ditto -c -k --keepParent "$APP" "$WORK/DevTex.zip"
xcrun notarytool submit "$WORK/DevTex.zip" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$APP"

echo "==> Creating DMG"
mkdir -p "$WORK/stage" "$OUTDIR"
ditto "$APP" "$WORK/stage/DevTex.app"
ln -s /Applications "$WORK/stage/Applications"
rm -f "$DMG"
hdiutil create -volname "DevTex" -srcfolder "$WORK/stage" -ov -format UDZO "$DMG"
codesign --sign "$IDENTITY" --timestamp "$DMG"

echo "==> Notarizing DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"

echo "==> Gatekeeper"
spctl -a -t open --context context:primary-signature -vv "$DMG"
spctl -a -t exec -vv "$APP"
echo "Done: $DMG"
