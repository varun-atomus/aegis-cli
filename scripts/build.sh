#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════
# Aegis CLI Build Script
# Compiles TypeScript and optionally packages into a standalone binary
# ═══════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "╔═══════════════════════════════╗"
echo "║  Building Aegis CLI           ║"
echo "╚═══════════════════════════════╝"
echo ""

# Clean previous build
echo "[1/3] Cleaning previous build..."
rm -rf dist/
echo "      Done."

# Compile TypeScript
echo "[2/3] Compiling TypeScript..."
npx tsc
echo "      Done."

# Add shebang to entry points
echo "[3/3] Finalizing..."
# Ensure the output files are executable
chmod +x dist/index.js dist/daemon.js 2>/dev/null || true

echo ""
echo "Build complete!"
echo "  CLI entry: dist/index.js"
echo "  Daemon:    dist/daemon.js"
echo ""

# Optional: Package into standalone binary
if [ "$1" = "--package" ]; then
  echo "Packaging into standalone binary..."

  mkdir -p bin/

  TARGET="${2:-node18-linux-x64}"

  npx pkg dist/index.js \
    --targets "$TARGET" \
    --output bin/aegis \
    --compress GZip

  echo ""
  echo "Binary created: bin/aegis"
  echo "Size: $(du -h bin/aegis | cut -f1)"
fi
