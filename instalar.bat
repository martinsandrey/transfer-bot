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
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo O Node.js instalado e antigo. Instale a versao LTS mais recente em https://nodejs.org e execute este arquivo de novo.
  node -v
  pause
  exit /b 1
)
node -v
echo Instalando dependencias (pode demorar um pouco)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo Falha ao instalar. Verifique a internet e o antivirus e tente de novo.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
echo Verificando o programa...
call npm run build
if errorlevel 1 (
  echo Falha ao preparar o programa. Envie esta tela ao desenvolvedor.
  pause
  exit /b 1
)
echo.
echo Pronto. Proximos passos:
echo   1. configurar.bat  - informe o endereco do sistema, usuario e senha
echo   2. telegram.bat    - login do Telegram e teste de envio
echo   3. iniciar.bat     - inicia o programa
pause
