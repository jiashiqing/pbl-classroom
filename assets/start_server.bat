@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ first.
  pause
  exit /b 1
)
echo.
echo   Classroom server starting...
echo   Teacher screen : http://localhost:5174/?mode=ppt
echo   Student screen : http://localhost:5174/?mode=student
echo.
echo   Close this window to stop the server.
echo.
node server.js
pause
