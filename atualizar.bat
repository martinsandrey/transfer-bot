@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .git (
  echo Esta pasta nao veio do git. Para atualizar: baixe o ZIP novo do GitHub e copie por cima, mantendo o seu arquivo .env.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo O Git nao foi encontrado. Instale em https://git-scm.com ou baixe o ZIP novo do GitHub.
  pause
  exit /b 1
)
echo Atualizando o programa (o seu .env e a sessao do Telegram nao sao alterados)...
git pull
if errorlevel 1 (
  echo Nao consegui atualizar. Envie esta tela ao desenvolvedor.
  pause
  exit /b 1
)
call npm install --no-audit --no-fund --loglevel=error
echo Conferindo se ha variaveis novas para o seu .env...
call npm run atualizar-env --silent
echo Pronto.
pause
