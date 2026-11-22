# Kişisel Finans — bilgisayar köprüsü kurulumu (Windows)
# Kullanım: kur.ps1 ve kopru.mjs dosyalarını aynı klasöre indirip PowerShell'de:
#   powershell -ExecutionPolicy Bypass -File .\kur.ps1
# kopru.mjs yanında yoksa uygulamanın adresinden indirilir.
# Birden fazla kez çalıştırmak güvenlidir: kurulu olanı atlar.

$ErrorActionPreference = 'Stop'
$Site = 'https://fatihdlcgl42-jpg.github.io'
$Dizin = Join-Path $env:LOCALAPPDATA 'KisiselFinansKopru'
New-Item -ItemType Directory -Force -Path $Dizin | Out-Null

function Yolu-Yenile {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.local\bin;$env:ProgramFiles\Tailscale"
}
function Var([string]$Komut) { [bool](Get-Command $Komut -ErrorAction SilentlyContinue) }
function Adim([string]$Metin) { Write-Host ''; Write-Host "==> $Metin" -ForegroundColor Cyan }

Yolu-Yenile

Adim '1/5 Node.js'
if (Var 'node') { Write-Host 'Kurulu.' } else {
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Yolu-Yenile
}

Adim '2/5 Claude Code'
if (Var 'claude') { Write-Host 'Kurulu.' } else {
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  Yolu-Yenile
}

Adim '3/5 Tailscale'
if (Var 'tailscale') { Write-Host 'Kurulu.' } else {
  winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
  Yolu-Yenile
}

Adim '4/5 Köprü programı'
# Önce bu betiğin yanındaki kopru.mjs kullanılır (GitHub'dan indirildiyse); yoksa siteden indirilir.
$Yanindaki = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'kopru.mjs' } else { $null }
if ($Yanindaki -and (Test-Path $Yanindaki)) {
  Copy-Item $Yanindaki (Join-Path $Dizin 'kopru.mjs') -Force
  Write-Host 'Yanındaki kopru.mjs kullanıldı.'
} else {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing "$Site/kopru/kopru.mjs" -OutFile (Join-Path $Dizin 'kopru.mjs')
  } catch {
    Write-Host 'kopru.mjs indirilemedi (site bu internette engelli olabilir). kopru.mjs dosyasını GitHub''dan indirip bu betikle aynı klasöre koyun ve betiği yeniden çalıştırın.' -ForegroundColor Red
    return
  }
}
node (Join-Path $Dizin 'kopru.mjs') --kur

Adim '5/5 Tailscale HTTPS adresi'
$Adres = $null
try {
  tailscale serve --bg 8787 | Out-Host
  $Durum = tailscale status --json | ConvertFrom-Json
  $Adres = 'https://' + $Durum.Self.DNSName.TrimEnd('.')
} catch {
  Write-Host 'Tailscale henüz hazır değil. Sağ alttaki Tailscale simgesinden giriş yapıp bu komutu yeniden çalıştırın.' -ForegroundColor Yellow
}

# Köprüyü ayrı bir pencerede başlat (zaten çalışıyorsa yeni pencere "port kullanımda" deyip kapanır).
Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"' + (Join-Path $Dizin 'kopru.mjs') + '"')

Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
if ($Adres) { Write-Host "  Uygulamaya girilecek ADRES: $Adres" -ForegroundColor Green }
Write-Host '  EŞLEŞTİRME KODU: yeni açılan köprü penceresinde yazıyor.' -ForegroundColor Green
Write-Host '  Claude girişi yapmadıysanız: bu pencereye  claude  yazıp giriş yapın, sonra /exit yazın.' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
