@echo off
REM Luminus OCR Setup for Windows
REM Run this as Administrator if your uploaded PDFs are scanned images.

echo === Luminus OCR Setup ===
echo.

echo [1/3] Installing Tesseract OCR via winget...
winget install Tesseract-OCR --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo winget install failed. Please install Tesseract manually from:
    echo https://github.com/UB-Mannheim/tesseract/wiki
    pause
    exit /b 1
)

echo.
echo [2/3] Installing Python OCR packages...
python -m pip install --upgrade pytesseract Pillow

echo.
echo [3/3] Verifying installation...
python -c "import pytesseract; print('Tesseract version:', pytesseract.get_tesseract_version())"
if errorlevel 1 (
    echo Verification failed. Make sure Tesseract is in PATH and restart your terminal.
    pause
    exit /b 1
)

echo.
echo === OCR Setup Complete ===
echo Now restart your Luminus server: Ctrl+C, then run 'npm run dev' or 'node server.js'
pause
