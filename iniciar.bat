@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Verificando dependencias...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo Falha ao instalar. Verifique a internet e o antivirus e tente de novo.
  pause
  exit /b 1
)
call npm start
echo.
echo O programa foi encerrado.
pause
