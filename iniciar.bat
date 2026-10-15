@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm start
echo.
echo O programa foi encerrado.
pause
