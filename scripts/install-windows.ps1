# Windows compatibility bootstrap for MSO.
# The stable Windows host path is WSL2 + a normal Linux distro, preserving the
# same Linux host-runtime contract used by every other MSO host adapter.
$ErrorActionPreference = "Stop"

$RequestedDistro = $env:MSO_WSL_DISTRO
$InstallUrl = if ($env:MSO_INSTALL_URL) {
  $env:MSO_INSTALL_URL
} else {
  "https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh"
}

function Info([string]$Message) { Write-Host "· $Message" }
function Ok([string]$Message) { Write-Host "✓ $Message" }
function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

if ($RequestedDistro -and ($RequestedDistro -notmatch '^[A-Za-z0-9._-]+$')) {
  Fail "Invalid WSL distro name."
}

if (-not (Get-Command "wsl.exe" -ErrorAction SilentlyContinue)) {
  Fail "WSL2 is required. Enable Windows Subsystem for Linux, then rerun this installer."
}

$RawDistros = & wsl.exe -l -q 2>$null
$Distros = @(
  $RawDistros |
    ForEach-Object { $_.Trim([char]0).Trim() } |
    Where-Object { $_ -and ($_ -notlike "docker-desktop*") }
)

$Distro = if ($RequestedDistro) {
  $RequestedDistro
} elseif ($Distros.Count -gt 0) {
  $Distros[0]
} else {
  "Ubuntu"
}

if ($Distros -notcontains $Distro) {
  Info "Installing WSL2 distro: $Distro"
  & wsl.exe --install -d $Distro
  if ($LASTEXITCODE -ne 0) {
    Fail "WSL installation failed."
  }
  Write-Host ""
  Write-Host "Windows may require a reboot or first-launch Linux user setup."
  Write-Host "Complete that setup, then rerun this same MSO installer command."
  exit 0
}

Info "Installing/updating MSO inside WSL2 ($Distro)"
$Script = @'
set -Eeuo pipefail
unset PREFIX TERMUX_VERSION
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
curl -fsSL "$MSO_INSTALL_URL" | bash -s -- --no-onboard
command -v mso >/dev/null
mso --version
mso -h >/dev/null
'@

& wsl.exe -d $Distro -- env "MSO_INSTALL_URL=$InstallUrl" bash -lc $Script
if ($LASTEXITCODE -ne 0) {
  Fail "MSO install inside WSL2 failed."
}

Ok "MSO is installed for Windows through WSL2."
Write-Host ""
Write-Host "Verify inside WSL2:"
Write-Host "  wsl -d $Distro"
Write-Host '  export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"'
Write-Host "  mso doctor"
Write-Host ""
Write-Host "MSO manages the WSL2 Linux distro, not Windows services/processes directly."
