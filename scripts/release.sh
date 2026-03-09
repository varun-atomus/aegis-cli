#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════
# Aegis CLI Release Script
# Creates a release tarball with binary, systemd services, and installer
# ═══════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

VERSION=$(node -p "require('./package.json').version")
RELEASE_NAME="aegis-cli-${VERSION}-linux-x64"
RELEASE_DIR="release/${RELEASE_NAME}"

echo "╔═══════════════════════════════╗"
echo "║  Aegis CLI Release v${VERSION}    ║"
echo "╚═══════════════════════════════╝"
echo ""

# Step 1: Build
echo "[1/4] Building..."
bash scripts/build.sh --package
echo ""

# Step 2: Create release directory
echo "[2/4] Assembling release..."
rm -rf release/
mkdir -p "$RELEASE_DIR"

# Copy binary
cp bin/aegis "$RELEASE_DIR/"

# Copy systemd services
mkdir -p "$RELEASE_DIR/systemd"
cp assets/systemd/*.service "$RELEASE_DIR/systemd/"

# Copy install script
cp assets/install.sh "$RELEASE_DIR/"
chmod +x "$RELEASE_DIR/install.sh"

echo "      Done."

# Step 3: Create tarball
echo "[3/4] Creating tarball..."
cd release/
tar -czf "${RELEASE_NAME}.tar.gz" "$RELEASE_NAME/"
cd ..

echo "      Done."

# Step 4: Checksums
echo "[4/4] Generating checksums..."
cd release/
sha256sum "${RELEASE_NAME}.tar.gz" > "${RELEASE_NAME}.tar.gz.sha256"
cd ..

echo ""
echo "Release artifacts:"
echo "  release/${RELEASE_NAME}.tar.gz"
echo "  release/${RELEASE_NAME}.tar.gz.sha256"
echo "  Size: $(du -h release/${RELEASE_NAME}.tar.gz | cut -f1)"
echo ""
