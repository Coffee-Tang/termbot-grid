#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"

# Read version from tauri.conf.json
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
APP_NAME="iTermBotGrid"
DIST_DIR="${SCRIPT_DIR}/dist"
BUNDLE_DIR="${SCRIPT_DIR}/src-tauri/target/release/bundle/macos"

echo "==> Building ${APP_NAME} v${VERSION}..."

# Build
cd src-tauri
cargo tauri build --bundles app 2>&1 || true
cd "${SCRIPT_DIR}"

# Check if .app was generated
if [ ! -d "${BUNDLE_DIR}/${APP_NAME}.app" ]; then
  echo "ERROR: ${APP_NAME}.app not found"
  exit 1
fi

# Create dist directory
mkdir -p "${DIST_DIR}"

# Zip the .app bundle
ZIP_NAME="${APP_NAME}_v${VERSION}_macos.zip"
echo "==> Packaging ${ZIP_NAME}..."
cd "${BUNDLE_DIR}"
zip -r -q "${DIST_DIR}/${ZIP_NAME}" "${APP_NAME}.app"
cd "${SCRIPT_DIR}"

echo "==> Done: ${DIST_DIR}/${ZIP_NAME}"
ls -lh "${DIST_DIR}/${ZIP_NAME}"
