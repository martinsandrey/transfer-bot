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
set ARGS=%*
if not "%ARGS%"=="" goto executar
echo.
echo  1 - hoje
echo  2 - ontem
echo  3 - esta semana (desde segunda-feira)
echo  4 - ultimos 7 dias
echo  5 - este mes
echo  6 - tudo
echo  7 - escolher datas
echo.
set /p ESC=Digite de 1 a 7 e Enter (Enter = hoje): 
set ARGS=hoje
if "%ESC%"=="2" set ARGS=ontem
if "%ESC%"=="3" set ARGS=semana
if "%ESC%"=="4" set ARGS=7dias
if "%ESC%"=="5" set ARGS=mes
if "%ESC%"=="6" set ARGS=tudo
if "%ESC%"=="7" goto datas
goto executar
:datas
set /p DE=Data inicial (AAAA-MM-DD): 
set /p ATE=Data final (AAAA-MM-DD, Enter = so o dia inicial): 
set ARGS=de=%DE%
if not "%ATE%"=="" set ARGS=de=%DE% ate=%ATE%
:executar
call npm run relatorio -- %ARGS%
pause
