@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Dependencias nao instaladas. Instalando agora, so na primeira vez...
  call npm ci
  if errorlevel 1 (
    echo Falha ao instalar. Verifique a internet e o antivirus e tente de novo.
    pause
    exit /b 1
  )
)
call npm start
echo.
echo O programa foi encerrado.
pause
