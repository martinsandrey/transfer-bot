@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Transfer Bot: instalacao ===
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e execute este arquivo de novo.
  pause
  exit /b 1
)
node -v
echo Instalando dependencias (pode demorar um pouco)...
call npm ci
if errorlevel 1 (
  echo Falha ao instalar. Verifique a internet e o antivirus e tente de novo.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
echo.
echo Pronto. Proximo passo: execute configurar.bat para informar o endereco do sistema.
pause
