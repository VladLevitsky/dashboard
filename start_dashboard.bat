@echo off
echo Starting Personal Dashboard...
echo.
echo Your dashboard will be available at: http://localhost:5000
echo.
echo Press Ctrl+C to stop the server
echo.
cd /d "%~dp0"
python -m http.server 5000
pause

