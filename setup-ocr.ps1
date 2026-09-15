# Luminus OCR Setup for Windows
# Run this in PowerShell as Administrator if your uploaded PDFs are scanned images.

$ErrorActionPreference = "Stop"

Write-Host "=== Luminus OCR Setup ===" -ForegroundColor Cyan
Write-Host ""

# 1. Install Tesseract OCR via winget
Write-Host "[1/3] Checking Tesseract OCR..." -ForegroundColor Yellow
$tesseract = Get-Command tesseract -ErrorAction SilentlyContinue
if ($tesseract) {
    Write-Host "Tesseract is already installed: $($tesseract.Source)" -ForegroundColor Green
} else {
    Write-Host "Installing Tesseract OCR via winget..." -ForegroundColor Yellow
    try {
        winget install Tesseract-OCR --accept-package-agreements --accept-source-agreements
    } catch {
        Write-Host "winget install failed. Please download and install Tesseract manually from https://github.com/UB-Mannheim/tesseract/wiki" -ForegroundColor Red
        exit 1
    }
}

# Refresh PATH in this session
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

# 2. Install Python OCR packages
Write-Host ""
Write-Host "[2/3] Installing Python OCR packages..." -ForegroundColor Yellow
python -m pip install --upgrade pytesseract Pillow

# 3. Verify
Write-Host ""
Write-Host "[3/3] Verifying installation..." -ForegroundColor Yellow
python -c "import pytesseract; print('Tesseract version:', pytesseract.get_tesseract_version())"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Verification failed. Make sure Tesseract is in your PATH and you restarted your terminal." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== OCR Setup Complete ===" -ForegroundColor Green
Write-Host "Now restart your Luminus server (Ctrl+C, then 'npm run dev' or 'node server.js')." -ForegroundColor Green
