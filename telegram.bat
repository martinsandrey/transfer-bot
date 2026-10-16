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
set CMD=%~1
if not "%CMD%"=="" goto executar
echo.
echo  1 - login  (entrar na sua conta do Telegram)
echo  2 - chats  (listar conversas e seus IDs)
echo  3 - teste  (enviar uma mensagem de teste)
echo.
set /p ESC=Digite 1, 2 ou 3 e Enter: 
if "%ESC%"=="1" set CMD=login
if "%ESC%"=="2" set CMD=chats
if "%ESC%"=="3" set CMD=teste
if "%CMD%"=="" (
  echo Opcao invalida.
  pause
  exit /b 1
)
:executar
call npm run telegram -- %CMD%
pause
