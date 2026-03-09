#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════
# Aegis CLI Installer
# Usage: curl -sSL https://install.atomuscyber.com/aegis-cli | bash
# ═══════════════════════════════════════════════════════════════════

AEGIS_VERSION="${AEGIS_VERSION:-latest}"
INSTALL_DIR="/usr/local/bin"
DATA_DIR="/var/lib/aegis-cli"
LOG_DIR="/var/log/aegis-cli"
SHIELD_DIR="/opt/atomus-shield"
SYSTEMD_DIR="/etc/systemd/system"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── Pre-flight Checks ────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       Aegis CLI Installer              ║${NC}"
echo -e "${BOLD}║       by Atomus Corporation            ║${NC}"
echo -e "${BOLD}╚════════════════════════════════════════╝${NC}"
echo ""

# Check for root
if [ "$EUID" -ne 0 ]; then
  error "This installer must be run as root. Use: sudo bash install.sh"
fi

# Check OS
if [ "$(uname -s)" != "Linux" ]; then
  error "Aegis CLI is only supported on Linux."
fi

# Check architecture
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "aarch64" ]; then
  error "Unsupported architecture: $ARCH. Supported: x86_64, aarch64"
fi

# Check for required tools
for cmd in curl tar systemctl; do
  if ! command -v "$cmd" &> /dev/null; then
    error "Required command not found: $cmd"
  fi
done

info "Platform: Linux ($ARCH)"
info "Version: $AEGIS_VERSION"
echo ""

# ─── Create Directories ───────────────────────────────────────────

info "Creating directories..."
mkdir -p "$DATA_DIR"
mkdir -p "$DATA_DIR/osquery"
mkdir -p "$LOG_DIR"
mkdir -p "$SHIELD_DIR"
success "Directories created"

# ─── Download and Install Binary ──────────────────────────────────

info "Downloading Aegis CLI binary..."

# TODO: Replace with actual download URL
DOWNLOAD_URL="https://releases.atomuscyber.com/aegis-cli/${AEGIS_VERSION}/aegis-linux-${ARCH}"

if [ "$AEGIS_VERSION" = "latest" ]; then
  # Fetch latest version
  warn "Download URL not yet configured. Skipping binary download."
  warn "Please manually place the aegis binary in ${INSTALL_DIR}/aegis"
else
  if curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/aegis" 2>/dev/null; then
    chmod +x "${INSTALL_DIR}/aegis"
    success "Binary installed to ${INSTALL_DIR}/aegis"
  else
    warn "Could not download binary. Please install manually."
  fi
fi

# ─── Install Systemd Services ─────────────────────────────────────

info "Installing systemd services..."

# Install aegis-cli service
cat > "${SYSTEMD_DIR}/aegis-cli.service" << 'SVCEOF'
[Unit]
Description=Aegis CLI Daemon - Device Compliance Monitoring
Documentation=https://portal.atomuscyber.us
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/aegis daemon start --foreground
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5
NoNewPrivileges=false
ProtectSystem=false
PrivateTmp=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aegis-cli
Environment=NODE_ENV=production
WorkingDirectory=/var/lib/aegis-cli

[Install]
WantedBy=multi-user.target
SVCEOF

# Install atomus-shield service
cat > "${SYSTEMD_DIR}/atomus-shield.service" << 'SVCEOF'
[Unit]
Description=Atomus Shield Security Agent
Documentation=https://portal.atomuscyber.us
After=network-online.target
Wants=network-online.target
Before=aegis-cli.service

[Service]
Type=simple
ExecStart=/opt/atomus-shield/atomus-shield
Restart=always
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=10
User=root
Group=root
ProtectHome=read-only
PrivateTmp=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=atomus-shield
WorkingDirectory=/opt/atomus-shield

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
success "Systemd services installed"

# ─── Post-Install ─────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo ""
echo -e "  1. ${BOLD}Authenticate:${NC}"
echo -e "     ${BLUE}aegis auth login${NC}"
echo ""
echo -e "  2. ${BOLD}Initialize:${NC}"
echo -e "     ${BLUE}aegis config init${NC}"
echo ""
echo -e "  3. ${BOLD}Start daemon:${NC}"
echo -e "     ${BLUE}aegis daemon start --systemd${NC}"
echo ""
echo -e "  4. ${BOLD}Check status:${NC}"
echo -e "     ${BLUE}aegis status${NC}"
echo ""
echo -e "For help: ${BLUE}aegis --help${NC}"
echo ""
