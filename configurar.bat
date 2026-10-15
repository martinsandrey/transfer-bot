@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
echo Abrindo o arquivo .env no Bloco de Notas. Preencha SITE_URL (e, se quiser, usuario e senha), salve e feche.
notepad .env
echo.
echo Deseja editar tambem o modelo da mensagem (config\mensagem.txt)?
choice /c SN /m "Editar modelo"
if errorlevel 2 exit /b 0
notepad config\mensagem.txt
