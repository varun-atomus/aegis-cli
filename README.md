# Aegis CLI

Device compliance monitoring for headless Linux servers.

## Quick Start

```bash
# One command to authenticate, pull config, start shield/osquery, and launch daemon
aegis start --cloud gov

# Check everything is running
aegis status
```

## Prerequisites

### Ubuntu / Debian

```bash
sudo apt-get update && sudo apt-get install -y \
  git curl sudo \
  libsecret-1-0 libglib2.0-0 dbus \
  software-properties-common gnupg
```

### RHEL / CentOS / Amazon Linux

```bash
yum install -y git curl sudo libsecret dbus-libs gnupg2
```

### Node.js (>= 18)

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
sudo apt-get install -y nodejs
sudo apt install npm

# RHEL / CentOS
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs

# Verify
node -v   # should be >= 18
npm -v
```

| Package | Why |
|---|---|
| `git` | Clone the repo |
| `curl` | Download binaries and packages |
| `sudo` | Shield/osquery install commands (skip if running as root) |
| `libsecret-1-0` | MSAL token persistence (keyring) |
| `libglib2.0-0`, `dbus` | Required by libsecret |
| `nodejs >= 18` | Runtime (nullish coalescing, crypto APIs) |

## Install

### From source

```bash
git clone https://github.com/Atomus3D/aegis-cli.git
cd aegis-cli
npm install
npm run build
```

### Package a binary

```bash
npm run package                    # all platforms
npm run package:linux-x64          # Linux x64 only
npm run package:linux-arm64        # Linux ARM64 only
npm run package:mac                # macOS ARM64 only
```

### Deploy the binary

```bash
sudo cp bin/aegis-linux-x64 /usr/local/bin/aegis
sudo chmod +x /usr/local/bin/aegis
sudo apt-get install -y libsecret-1-0
```

## Authentication

**Government cloud** (`.us` / `.mil` emails):

```bash
aegis auth login --cloud gov
```

**Commercial cloud** (default):

```bash
aegis auth login
```

Other auth commands:

```bash
aegis auth status       # show current auth state
aegis auth token        # print access token (for scripting)
aegis auth logout       # clear stored credentials
```

## Services

### Config

```bash
aegis config pull                  # pull config from Atomus API
aegis config init                  # pull config + init shield
aegis config show                  # show cached config keys
aegis config show --key <key>      # show a specific key
```

### Shield (auto-installed from Azure Blob)

```bash
aegis shield status                # check shield daemon
```

Shield is automatically downloaded and launched during `aegis start` or `aegis config init`.

### Osquery (auto-installed on Linux)

Osquery binary is installed from official packages. Configs and packs are downloaded from Azure Blob Storage:

| Blob Container | Contents |
|---|---|
| `osquery-configs-linux` | `osquery.conf` and config files |
| `osquery-packs-linux` | Platform-specific query packs |
| `osquery-packs-609` | Cross-platform query packs |

Osquery is automatically set up during `aegis start`.

### Daemon

```bash
aegis daemon start                 # background process
aegis daemon start --foreground    # foreground (for debugging)
aegis daemon start --systemd       # via systemd (production)
aegis daemon stop                  # stop background daemon
aegis daemon restart               # restart
aegis daemon status                # show PID and systemd state
aegis daemon logs                  # last 50 lines
aegis daemon logs -n 200           # last 200 lines
aegis daemon logs -f               # follow in real time
```

The daemon runs a daily healthcheck (2 PM) and keeps shield + osquery alive.

## Compliance

```bash
aegis compliance list              # list all tests
aegis compliance run               # run all tests
aegis compliance run --json        # JSON output
aegis compliance test <name>       # run one test
```

Available tests: `testShieldStatus`, `testDefender`, `testDiskEncryption`, `testFipsEnabled`, `testOsqueryStatus`, `testCisBenchmarks`, `testIntune`

## Debug Mode

Prefix any command with `ATOMUS_DEBUG=true` for verbose logging:

```bash
ATOMUS_DEBUG=true aegis start --cloud gov
ATOMUS_DEBUG=true aegis compliance run
ATOMUS_DEBUG=true aegis daemon start --foreground
```

## Logs

**Local logs** are written to `~/.atomus/aegis/logs/` (or `/var/log/aegis-cli/`):

```bash
aegis daemon logs                  # quick view
ls ~/.atomus/aegis/logs/           # list log files
```

**Cloud logs** are uploaded to Azure Log Analytics on every compliance run (manual or daemon scheduled). Records include:

- `AppSource = "aegis-cli"` — filter CLI logs from other sources
- `ExecutionMode = "cli"` or `"daemon"` — distinguish manual vs automated

KQL example:

```kusto
AegisHealthcheck_CL
| where AppSource_s == "aegis-cli"
| where ExecutionMode_s == "daemon"
| order by TimeGenerated desc
```

## Stop Everything

```bash
aegis daemon stop                              # stop daemon
pkill -f osqueryd 2>/dev/null                  # stop osquery
pkill -f atomus-shield 2>/dev/null             # stop shield
```

Or with systemd:

```bash
sudo systemctl stop aegis-cli
sudo systemctl stop atomus-shield
sudo systemctl stop osqueryd
```

## Uninstall

```bash
aegis uninstall
```

Or manually:

```bash
sudo rm /usr/local/bin/aegis
sudo rm -rf /var/lib/aegis-cli /var/log/aegis-cli /opt/atomus-shield
rm -rf ~/.atomus/aegis
```
