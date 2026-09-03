#!/usr/bin/env bash
#
# Build, sign and upload an iOS build to TestFlight from this machine.
#
# The local twin of .github/workflows/ios-testflight.yml. Same project, same
# scheme, same archive and export commands, same altool upload — so a build made
# here is the same build CI would have made, and a failure here is reproducible
# there.
#
# It follows CI's signing path exactly rather than Xcode's: the distribution
# certificate is imported into a THROWAWAY keychain that is deleted on exit, and
# signing is left to automatic provisioning driven by an App Store Connect API
# key (-allowProvisioningUpdates). Nothing here touches the login keychain or
# needs an Apple ID signed into Xcode — which the MDM profile on this Mac blocks
# anyway (see CLAUDE.md). The .p12 carries both the Apple Distribution and Apple
# Development identities from one CSR; the development half exists only so
# automatic signing does not mint a fresh development certificate on every run.
#
# NOTE: no local archive has ever been run for this project before — CI has
# always been first. Run with --no-upload the first time so a signing problem
# surfaces without creating a permanent App Store Connect build record.
#
# Configuration lives in .env.release (gitignored) — see .env.release.example.
#
#   npm run release:ios                     # build, then upload to TestFlight
#   npm run release:ios -- --no-upload      # archive and export only
#   npm run release:ios -- --version 1.0 --build 41
#
set -euo pipefail

cd "$(dirname "$0")/.."

SCHEME="App"
# SPM-based Capacitor project: there is no .xcworkspace, and passing one fails
# with "does not exist" before any build starts.
XCODE_PROJECT="ios/App/App.xcodeproj"
# Team and bundle ids are not secret — they already appear in the committed
# workflow and ExportOptions.plist — so they are defaults here, overridable
# from the environment.
DEFAULT_TEAM_ID="9DTLYZS258"
BUNDLE_ID="${BUNDLE_ID:-org.wvvy.app}"

UPLOAD=1
MARKETING_VERSION=""
BUILD_NUMBER=""

# Captured before the loop below consumes them: the `op run` re-exec further down
# has to hand the script its ORIGINAL arguments. Passing "$@" after parsing meant
# passing nothing at all, which silently turned --no-upload into an upload.
ORIGINAL_ARGS=("$@")

while [ $# -gt 0 ]; do
  case "$1" in
    --no-upload) UPLOAD=0 ;;
    --upload) UPLOAD=1 ;;
    --version) MARKETING_VERSION="${2:?--version needs a value}"; shift ;;
    --build) BUILD_NUMBER="${2:?--build needs a value}"; shift ;;
    -h | --help)
      awk 'NR > 1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1 (try --help)" >&2
      exit 2
      ;;
  esac
  shift
done

# Secrets may be 1Password references rather than values.
#
# `op run` resolves every op:// reference in the env file, injects the results as
# environment variables and masks them in this script's output, so nothing
# sensitive is ever written to disk or scrollback. Re-running the script through
# it is what makes `npm run release:ios` work unchanged either way: with plain
# values (or local file paths) in .env.release nothing happens here, and with
# op:// references the script restarts itself under `op run` exactly once.
ENV_FILE=".env.release"
if [ -z "${RELEASE_ENV_INJECTED:-}" ] && [ -f "$ENV_FILE" ] && grep -q 'op://' "$ENV_FILE"; then
  command -v op > /dev/null || {
    echo "error: $ENV_FILE holds op:// references but the 1Password CLI is not installed" >&2
    exit 1
  }
  export RELEASE_ENV_INJECTED=1
  exec op run --env-file="$ENV_FILE" -- "$0" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
fi

# Skipped when `op run` already injected them: sourcing the file a second time
# would overwrite real secrets with the literal op:// strings.
# shellcheck source=/dev/null
[ -z "${RELEASE_ENV_INJECTED:-}" ] && [ -f "$ENV_FILE" ] && set -a && . "./$ENV_FILE" && set +a

fail() {
  echo "error: $*" >&2
  exit 1
}

APPLE_TEAM_ID="${APPLE_TEAM_ID:-$DEFAULT_TEAM_ID}"
: "${APPSTORE_KEY_ID:?set APPSTORE_KEY_ID in .env.release}"
: "${APPSTORE_ISSUER_ID:?set APPSTORE_ISSUER_ID in .env.release}"
: "${IOS_DIST_CERT_PASSWORD:?set IOS_DIST_CERT_PASSWORD in .env.release}"

WORK="$(mktemp -d)"
KEYCHAIN_PATH="$WORK/signing.keychain-db"
# The user's keychain search list is captured before we prepend the throwaway
# keychain and restored on exit, so a work Mac's other keychains are not dropped.
ORIGINAL_KEYCHAINS=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"   # trim leading whitespace
  line="${line%\"}"; line="${line#\"}"       # strip the surrounding quotes
  [ -n "$line" ] && ORIGINAL_KEYCHAINS+=("$line")
done < <(security list-keychains -d user)
cleanup() {
  [ "${#ORIGINAL_KEYCHAINS[@]}" -gt 0 ] &&
    security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" 2> /dev/null || true
  security delete-keychain "$KEYCHAIN_PATH" 2> /dev/null || true
  rm -rf "$WORK"
  [ -n "${INSTALLED_KEY:-}" ] && [ "${KEY_WAS_INSTALLED:-1}" -eq 0 ] && rm -f "$INSTALLED_KEY"
  true
}
trap cleanup EXIT

# The App Store Connect key may be a path (how it is kept locally) or an inline
# PEM (how CI and 1Password hold it). Normalise to a file either way.
KEY_FILE="$WORK/AuthKey.p8"
if [ -n "${APPSTORE_PRIVATE_KEY_PATH:-}" ]; then
  [ -f "$APPSTORE_PRIVATE_KEY_PATH" ] || fail "APPSTORE_PRIVATE_KEY_PATH points at no such file: $APPSTORE_PRIVATE_KEY_PATH"
  cp "$APPSTORE_PRIVATE_KEY_PATH" "$KEY_FILE"
elif [ -n "${APPSTORE_PRIVATE_KEY:-}" ]; then
  printf '%s\n' "$APPSTORE_PRIVATE_KEY" > "$KEY_FILE"
else
  fail "set APPSTORE_PRIVATE_KEY_PATH (or APPSTORE_PRIVATE_KEY) in .env.release"
fi

# The distribution .p12 may be a path (the signing.p12 kept outside the repo) or
# the same base64 blob CI holds in a secret (how 1Password stores it). One
# 1Password item can then feed both this script and `gh secret set`.
CERT_P12="$WORK/dist.p12"
if [ -n "${IOS_DIST_CERT_P12_PATH:-}" ]; then
  [ -f "$IOS_DIST_CERT_P12_PATH" ] || fail "IOS_DIST_CERT_P12_PATH points at no such file: $IOS_DIST_CERT_P12_PATH"
  cp "$IOS_DIST_CERT_P12_PATH" "$CERT_P12"
elif [ -n "${IOS_DIST_CERT_P12_BASE64:-}" ]; then
  printf '%s' "$IOS_DIST_CERT_P12_BASE64" | base64 --decode > "$CERT_P12" ||
    fail "IOS_DIST_CERT_P12_BASE64 is not valid base64"
else
  fail "set IOS_DIST_CERT_P12_PATH (or IOS_DIST_CERT_P12_BASE64) in .env.release"
fi

# App Store Connect rejects uploads built against anything below the iOS 26 SDK
# with a 409 at the altool stage — after a full successful archive and export.
# Checking here costs a second instead of ten minutes.
SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
[ "${SDK_VERSION%%.*}" -ge 26 ] || fail "iOS SDK $SDK_VERSION is below the iOS 26 minimum App Store Connect requires. Update Xcode."

# A tag names a version; anything else leaves the project's own value alone,
# exactly as the workflow does.
if [ -z "$MARKETING_VERSION" ]; then
  TAG="$(git describe --exact-match --tags 2> /dev/null || true)"
  [ -n "$TAG" ] && MARKETING_VERSION="${TAG#v}"
fi

# Build numbers are permanent: App Store Connect refuses one it has already seen
# and refuses one lower than the highest for that version. CI uses the ever-
# climbing run number; a laptop knows nothing about that, so ask App Store
# Connect what it already holds. --build overrides for the case where you know
# better.
if [ -z "$BUILD_NUMBER" ]; then
  echo "==> Asking App Store Connect for the next build number"
  BUILD_NUMBER="$(
    APPSTORE_KEY_ID="$APPSTORE_KEY_ID" \
      APPSTORE_ISSUER_ID="$APPSTORE_ISSUER_ID" \
      APPSTORE_PRIVATE_KEY_PATH="$KEY_FILE" \
      node scripts/asc-next-build.mjs --bundle-id "$BUNDLE_ID" ${MARKETING_VERSION:+--version "$MARKETING_VERSION"}
  )" || fail "could not derive a build number — pass one with --build N"
fi

echo "==> ${MARKETING_VERSION:-(project version)} build $BUILD_NUMBER"

# Signing assets live only for the life of this build, in a throwaway keychain —
# exactly as CI does it on a fresh runner. The .p12 carries two identities
# (Apple Distribution + Apple Development) sharing one private key; importing
# them keeps automatic signing from minting a new development certificate on
# every run and eventually hitting Apple's cert cap.
echo "==> Importing signing certificate into a throwaway keychain"
KEYCHAIN_PASSWORD="$(uuidgen)"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_P12" \
  -P "$IOS_DIST_CERT_PASSWORD" \
  -A -t cert -f pkcs12 \
  -k "$KEYCHAIN_PATH"
# Without this, codesign blocks on a GUI keychain-access prompt and the build
# hangs. The search-list line prepends the throwaway keychain to the existing
# list (restored on exit) so xcodebuild finds the identity without dropping any
# of the user's other keychains.
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" > /dev/null
security list-keychains -d user -s "$KEYCHAIN_PATH" ${ORIGINAL_KEYCHAINS[@]+"${ORIGINAL_KEYCHAINS[@]}"}
security find-identity -v -p codesigning "$KEYCHAIN_PATH"

echo "==> Building web bundle"
npm run build

echo "==> Syncing Capacitor"
npx cap sync ios

# altool only looks in these well-known directories for the key; xcodebuild takes
# an explicit path. A key already installed here is left alone.
mkdir -p ~/.appstoreconnect/private_keys
INSTALLED_KEY="$HOME/.appstoreconnect/private_keys/AuthKey_${APPSTORE_KEY_ID}.p8"
KEY_WAS_INSTALLED=1
if [ ! -f "$INSTALLED_KEY" ]; then
  KEY_WAS_INSTALLED=0
  cp "$KEY_FILE" "$INSTALLED_KEY"
fi

# Signing is left entirely to automatic provisioning — no CODE_SIGN_IDENTITY
# override. It would contradict CODE_SIGN_STYLE=Automatic, and command-line build
# settings apply to every target in the graph, including SPM dependencies, which
# then fail with their own provisioning conflict.
echo "==> Archiving"
xcodebuild archive \
  -project "$XCODE_PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$WORK/App.xcarchive" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_FILE" \
  -authenticationKeyID "$APPSTORE_KEY_ID" \
  -authenticationKeyIssuerID "$APPSTORE_ISSUER_ID" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  ${MARKETING_VERSION:+MARKETING_VERSION="$MARKETING_VERSION"} \
  CODE_SIGN_STYLE=Automatic

echo "==> Exporting IPA"
xcodebuild -exportArchive \
  -archivePath "$WORK/App.xcarchive" \
  -exportOptionsPlist ios/App/ExportOptions.plist \
  -exportPath "$WORK/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_FILE" \
  -authenticationKeyID "$APPSTORE_KEY_ID" \
  -authenticationKeyIssuerID "$APPSTORE_ISSUER_ID"

IPA="$(find "$WORK/export" -maxdepth 1 -name '*.ipa' | head -1)"
[ -n "$IPA" ] || fail "no .ipa was produced"

# Kept out of the temp directory the trap deletes: a build worth uploading is a
# build worth still having on disk afterwards.
mkdir -p build-artifacts/ios
cp "$IPA" build-artifacts/ios/
rsync -a --include='*/' --include='*.dSYM/**' --exclude='*' "$WORK/App.xcarchive/dSYMs/" build-artifacts/ios/dSYMs/ 2> /dev/null || true
echo "==> Wrote build-artifacts/ios/$(basename "$IPA")"

if [ "$UPLOAD" -eq 0 ]; then
  echo "==> --no-upload: stopping before TestFlight"
  exit 0
fi

echo "==> Uploading to TestFlight"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$APPSTORE_KEY_ID" \
  --apiIssuer "$APPSTORE_ISSUER_ID"

echo "==> Uploaded build $BUILD_NUMBER. Processing takes a few minutes before it appears in TestFlight."
[ "$KEY_WAS_INSTALLED" -eq 1 ] || echo "    (the API key copied to ~/.appstoreconnect/private_keys was removed again)"
