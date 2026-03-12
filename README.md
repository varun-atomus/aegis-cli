# Aegis CLI

Standalone, terminal-based CLI for **Atomus Aegis** device compliance monitoring on headless Linux servers. Replaces the Electron-based desktop app for environments without a graphical interface.

## Overview

Aegis CLI provides the same core security and compliance functionality as the Aegis desktop app, but operates entirely through the command line. It reuses the existing **atomus-shield daemon** and backend infrastructure.

### Core Features

- **Device Code Authentication** — MSAL-based headless auth (no browser needed on the server)
- **Compliance Monitoring** — 7 automated compliance tests (Defender, disk encryption, FIPS, osquery, Shield, CIS benchmarks, Intune)
- **Background Daemon** — Scheduled daily healthchecks with auto-recovery
- **Log Analytics** — Results uploaded to Azure Log Analytics via HMAC-SHA256
- **Shield Integration** — Communicates with atomus-shield for privileged operations

### Architecture

| Electron App | Aegis CLI |
|---|---|
| Main Process | `daemon.ts` (always running) |
| Renderer Process | CLI client (`index.ts`, ephemeral) |
| IPC (context bridge) | Lazy service initialization |
| MSAL Interactive Browser | MSAL Device Code Flow |
| `electron-updater` | `aegis update` command |
| React pages & routing | Commander.js commands |
| `HC_CRON = "0 14 * * *"` | Same cron in daemon via toad-scheduler |

---

## Local Development

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9

### Setup

```bash
# Clone the repo
git clone https://github.com/Atomus3D/aegis-cli.git
cd aegis-cli

# Install dependencies
npm install

# Build
npm run build
```

### Running Locally

```bash
# Run CLI directly via ts-node (no build needed)
npm run dev -- --help
npm run dev -- auth status
npm run dev -- compliance list

# Or build first, then run compiled output
npm run build
node dist/index.js --help
node dist/index.js auth status
node dist/index.js compliance list

# Run daemon in foreground (for development)
node dist/daemon.js
```

### Development Scripts

```bash
npm run dev        # Run CLI via ts-node
npm run build      # Compile TypeScript to dist/
npm run clean      # Remove dist/ directory
npm run lint       # Run ESLint
npm run start      # Run compiled CLI (dist/index.js)
npm run daemon     # Run compiled daemon (dist/daemon.js)
```

### Debug Mode

Set `ATOMUS_DEBUG=true` to enable verbose console logging:

```bash
ATOMUS_DEBUG=true npm run dev -- status
ATOMUS_DEBUG=true node dist/daemon.js
```

---

## Installation (Production)

### Option A: One-Line Install (Recommended)

```bash
curl -sSL https://install.atomuscyber.com/aegis-cli | sudo bash
```

This will:
1. Download the `aegis` binary to `/usr/local/bin/`
2. Create data directories (`/var/lib/aegis-cli/`, `/var/log/aegis-cli/`)
3. Install systemd services (`aegis-cli.service`, `atomus-shield.service`)

### Option B: Manual Install from Release Tarball

```bash
# Download the release
wget https://releases.atomuscyber.com/aegis-cli/latest/aegis-cli-1.0.0-linux-x64.tar.gz

# Extract
tar -xzf aegis-cli-1.0.0-linux-x64.tar.gz
cd aegis-cli-1.0.0-linux-x64

# Run the installer
sudo bash install.sh
```

### Option C: Manual Install from Source

```bash
# Build from source
git clone https://github.com/Atomus3D/aegis-cli.git
cd aegis-cli
npm install
npm run build

# Package into standalone binary
npm run package

# Install binary
sudo cp bin/aegis /usr/local/bin/aegis
sudo chmod +x /usr/local/bin/aegis

# Create required directories
sudo mkdir -p /var/lib/aegis-cli/osquery
sudo mkdir -p /var/log/aegis-cli
sudo mkdir -p /opt/atomus-shield

# Install systemd services
sudo cp assets/systemd/aegis-cli.service /etc/systemd/system/
sudo cp assets/systemd/atomus-shield.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### Post-Install Setup

After installing, run through the initial setup:

```bash
# Step 1: Authenticate
aegis auth login --email user@company.com

# Step 2: Pull config and initialize shield
aegis config init

# Step 3: Verify compliance
aegis compliance run

# Step 4: Enable the daemon for daily automated checks
aegis daemon start --systemd

# Step 5: Verify everything is running
aegis status
```

---

## Directory Layout (Production)

```
/usr/local/bin/
└── aegis                            # CLI binary

/etc/systemd/system/
├── aegis-cli.service                # CLI daemon systemd service
└── atomus-shield.service            # Shield daemon systemd service

/opt/atomus-shield/
└── atomus-shield                    # Go daemon binary

/var/lib/aegis-cli/
├── config-cache.json                # Azure App Config cache
└── osquery/
    ├── osquery.conf
    └── packs/*.json

/var/log/aegis-cli/
├── cli-YYYY-MM-DD.log              # CLI process logs
└── daemon-YYYY-MM-DD.log           # Daemon process logs

~/.atomus/aegis/
├── credentials                      # Stored auth tokens (mode 0600)
└── config.json                      # User/tenant config
```

---

## Command Reference

### `aegis auth` — Authentication

```bash
# Login with device code flow (default: commercial cloud)
aegis auth login

# Login specifying cloud instance
aegis auth login --cloud gov

# Login with email (auto-detects commercial vs government cloud)
aegis auth login --email user@company.com

# Show current authentication status
aegis auth status

# Get a fresh access token (for scripting/piping)
aegis auth token

# Clear stored credentials
aegis auth logout
```

### `aegis config` — Configuration

```bash
# Pull fresh configuration from Atomus API
aegis config pull

# Show all cached config keys
aegis config show

# Show a specific config key
aegis config show --key LogAnalyticsInfo

# Show config as raw JSON
aegis config show --json

# Full initialization (pull config + init shield)
aegis config init
```

### `aegis compliance` — Compliance Monitoring

```bash
# List all available compliance tests
aegis compliance list

# Run ALL compliance tests
aegis compliance run

# Run with JSON output
aegis compliance run --json

# Run a single test
aegis compliance test testDefender
aegis compliance test testDiskEncryption
aegis compliance test testFipsEnabled
aegis compliance test testOsqueryStatus
aegis compliance test testShieldStatus
aegis compliance test testCisBenchmarks
aegis compliance test testIntune
```

Compliance results are uploaded to Azure Log Analytics (table based on `Log-Type`, currently `AegisHealthcheck`) whenever you run `aegis compliance run` or when the daemon runs scheduled checks.

### `aegis daemon` — Daemon Management

```bash
# Start daemon in background
aegis daemon start

# Start daemon in foreground (for debugging)
aegis daemon start --foreground

# Start via systemd (recommended for production)
aegis daemon start --systemd

# Stop daemon
aegis daemon stop

# Stop via systemd
aegis daemon stop --systemd

# Restart daemon
aegis daemon restart

# Show daemon status
aegis daemon status

# View daemon logs (last 50 lines)
aegis daemon logs

# View last N lines
aegis daemon logs --lines 100

# Follow logs in real-time
aegis daemon logs --follow
```

---

## Cloud Logs and CLI Filtering

To send logs to cloud Log Analytics:

1. Authenticate: `aegis auth login`
2. Pull config (includes Log Analytics workspace details): `aegis config pull`
3. Run checks manually: `aegis compliance run`  
   or run continuously via daemon: `aegis daemon start --systemd`

Cloud log records now include:
- `AppSource = "aegis-cli"`
- `ExecutionMode = "cli"` (manual command) or `"daemon"` (scheduled/background)

Example KQL:

```kusto
AegisHealthcheck_CL
| where AppSource_s == "aegis-cli"
| summarize count() by ExecutionMode_s
| order by count_ desc
```

### `aegis status` — Device Status

```bash
# Show full device and service status
aegis status

# JSON output (for scripting)
aegis status --json
```

### Other Commands

```bash
# Check for CLI updates
aegis update

# Show CLI version
aegis --version

# Show help
aegis --help

# Help for any command
aegis auth --help
aegis compliance --help
aegis daemon --help
aegis config --help
```

---

## First-Run Walkthrough

```bash
# 1. Authenticate with your organization
aegis auth login --email user@company.com
#    → Opens device code flow: visit the URL and enter the code shown

# 2. Initialize (pulls config + connects to shield)
aegis config init

# 3. Run a compliance check
aegis compliance run
#    → Shows pass/fail for all 7 tests

# 4. Start the daemon for daily automated monitoring
aegis daemon start --systemd

# 5. Confirm everything is running
aegis status
```

---

## Compliance Tests

| Test | Description |
|---|---|
| `testShieldStatus` | Confirm atomus-shield agent health |
| `testDefender` | Verify Microsoft Defender for Endpoint installation and status |
| `testDiskEncryption` | Check disk encryption status (LUKS, dm-crypt) |
| `testFipsEnabled` | Validate FIPS 140-2 compliance mode |
| `testOsqueryStatus` | Verify osquery daemon and extensions |
| `testCisBenchmarks` | Run CIS Level 1 benchmark checks |
| `testIntune` | Verify Microsoft Intune installation |

---

## Building a Release

```bash
# Build + package binary + create release tarball
bash scripts/release.sh
```

Output:
```
release/aegis-cli-1.0.0-linux-x64.tar.gz
release/aegis-cli-1.0.0-linux-x64.tar.gz.sha256
```

---

## Uninstall

```bash
# Stop services
sudo systemctl stop aegis-cli
sudo systemctl stop atomus-shield
sudo systemctl disable aegis-cli
sudo systemctl disable atomus-shield

# Remove files
sudo rm /usr/local/bin/aegis
sudo rm /etc/systemd/system/aegis-cli.service
sudo rm /etc/systemd/system/atomus-shield.service
sudo rm -rf /var/lib/aegis-cli
sudo rm -rf /var/log/aegis-cli
rm -rf ~/.atomus/aegis

sudo systemctl daemon-reload
```
