@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .env (
  echo Primeiro uso: vou abrir a configuracao. Preencha SITE_URL, salve e feche o Bloco de Notas.
  copy .env.example .env >nul
  notepad .env
)
echo Verificando dependencias...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo Falha ao instalar. Verifique a internet e o antivirus e tente de novo.
  pause
  exit /b 1
)
call npm run supervisor
echo.
echo O programa foi encerrado.
pause
