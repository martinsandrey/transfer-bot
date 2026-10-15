@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Simulacao com dados ficticios (nao acessa o site).
call npm run simular
pause
