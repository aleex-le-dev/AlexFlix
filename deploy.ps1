<#
  Alex Prime - deploiement en un clic vers l'hebergeur (FTP integre, sans FileZilla)

  .\deploy.ps1             scan du disque Freebox + liens de telechargement + envoi FTP
  .\deploy.ps1 -SansScan   liens de telechargement + envoi FTP (catalogue actuel)
  .\deploy.ps1 -SiteSeul   envoi de l'interface et du catalogue actuel, sans Freebox
#>
param(
  [switch]$SansScan,
  [switch]$SiteSeul
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host ">> $Message" -ForegroundColor Red
}

function Invoke-Npm([string[]]$Arguments, [string]$Failure) {
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-EnvValue([string]$Name) {
  $line = Get-Content -LiteralPath '.env' -Encoding UTF8 | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace "^\s*$Name\s*=\s*", '').Trim().Trim("'").Trim('"')
}

try {
  Write-Host "ALEX PRIME - deploiement" -ForegroundColor Red

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js introuvable : installez-le depuis https://nodejs.org' }
  if (-not (Test-Path -LiteralPath '.env')) { throw 'Fichier .env manquant : copiez .env.example en .env puis completez-le.' }

  $needsSetup = -not (Test-Path 'node_modules') -or -not (Test-Path 'server/node_modules/basic-ftp') -or -not (Test-Path 'client/node_modules/vite')
  if ($needsSetup) {
    Write-Step 'Installation des dependances'
    Invoke-Npm @('run', 'setup') 'npm run setup a echoue.'
  }

  if (-not $SiteSeul -and -not $SansScan) {
    $media = Get-EnvValue 'MEDIA_PATH'
    if ($media -and (Test-Path -LiteralPath $media)) {
      Write-Host "Scan via le disque monte : $media"
    } else {
      Write-Host "Disque non monte : scan via l'API Freebox OS ($(Get-EnvValue 'FREEBOX_MEDIA_ROOT'))"
      Write-Host "Au premier lancement, validez 'Alex Prime' sur l'ecran de la Freebox." -ForegroundColor Yellow
    }
  }

  Write-Step 'Compilation de la vitrine'
  Invoke-Npm @('run', 'build:vitrine', '--prefix', 'client') 'La compilation du site a echoue.'

  $deployArgs = @('run', 'deploy', '--prefix', 'server', '--')
  if ($SiteSeul) { $deployArgs += '--no-links' }
  elseif (-not $SansScan) { $deployArgs += '--scan' }

  Write-Step 'Publication FTP'
  Invoke-Npm $deployArgs 'La publication a echoue (voir le message ci-dessus).'

  Write-Host ""
  $site = Get-EnvValue 'SITE_URL'
  if ($site) { Write-Host "OK - site en ligne : $site" -ForegroundColor Green }
  else { Write-Host "OK - site en ligne" -ForegroundColor Green }
  exit 0
}
catch {
  Write-Host ""
  Write-Host "ECHEC : $($_.Exception.Message)" -ForegroundColor Yellow
  exit 1
}
