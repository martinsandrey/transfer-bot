# Plano das Fases 2–7

Regra geral: uma fase por vez; ao fim → testes verdes, commit, push, atualizar `PROGRESSO.md`, relatório e **parada** até
aprovação explícita. Marcação **[WIN]** = ponto em que o usuário precisa executar algo no Windows.

## Fase 2 — Navegador dedicado, login e leitura da tabela

**Entregáveis:** `Config` (zod, `.env`, erros em português) · `Logger` (pino, mascaramento, allow-list) · `Notifier` (som via
PowerShell, falso em testes) · `BrowserHost` (perfil persistente, janela visível, flags anti-throttling, `NAVEGADOR`) ·
`LoginManager` (detectar/auto 1x/manual/expirada — seletores só após evidência) · **`npm run recon`** · `TableReader`
tipado (telefones normalizados, `Start Time` com fuso, duração em segundos) · página simulada local que imita a estrutura
**confirmada**.
**Testes:** Playwright contra a página simulada: atualização a cada 1 s, reordenação, linhas somem/aparecem, leitura no
meio da atualização, expiração de sessão; unitários de normalização e config; teste que garante ausência de PII nos logs.
**Concluída quando:** testes simulados passam na nuvem **e** [WIN] o usuário confirma que login (automático e manual)
funciona, que a leitura real bate com a tela e que os logs não têm dados pessoais.
**[WIN]:** rodar o `recon` (antes de implementar o leitor), testar login, ler a tabela, janela minimizada/coberta.
_Observação:_ o `recon` precisa existir **antes** do leitor; a Fase 2 começa por ele e pausa para o usuário enviar a
evidência (ponto de parada intermediário dentro da fase, avisado no relatório).

## Fase 3 — Monitoramento e fila (somente simulação)

**Entregáveis:** `CallTracker` (ocorrência, linha de base, confirmação de N leituras, 1→3 gera, 1→2 descarta, inesperadas,
desconhecido, primeira vez em Stage 3, anomalia de callback duplicado, `gap`, `sweep`) · `TaskQueue` (estados, dedup em memória,
sequencial, travas, retries) · loop de monitoramento com `TableReader` simulado.
**Testes (todos os cenários do prompt):** mesma chamada mudando de posição; 1→2 (ignorar); 1→3 (tarefa); 2→3 (inesperado,
sem tarefa, aviso); primeira vez em 3 (sem tarefa, aviso); status oscilando; transição entre leituras; mesmo funcionário
com duas transferências no dia (2 tarefas); mesmo callback em 2 linhas (anomalia); reinício; chamada que some antes de ser
processada; mais: leitura inválida, janela cega, TTL/sweep.
**Concluída quando:** todos os cenários documentados têm teste passando. **[WIN]:** nenhum.

## Fase 4 — Customer Data List, pesquisa, cadastro e mensagem

**Entregáveis:** `CustomerLookup` (menu → Customer Data List em aba separada → Phone → Search → espera por resultado → 0/1/N →
abrir edição só para ler → conferir telefone = Callee → fechar sem salvar) · bloqueios de escrita (`context.route`) e anti-clique
repetido · `MessageBuilder` (modelo de `config/mensagem.txt`, validação de placeholders, cópia literal com `trim`) · página
simulada da Customer Data List.
**Testes:** contra página simulada (0/1/N resultados, telefone divergente, tentativa de escrita bloqueada, timeouts) e
unitários do modelo (texto exato, campos vazios, caracteres especiais/acentos/emoji, rótulos fixos `Occupation: ` e `NOTE:`).
**Concluída quando:** testes passam **e** [WIN] validação real em **modo observação** com prévia só no console e confirmação
do usuário de que os campos mapeados batem. **[WIN]:** rodar o `recon` da Customer Data List (formulário), observação real.

## Fase 5 — Integração com o Telegram (só após decisão do usuário)

**Entregáveis:** implementação escolhida atrás de `MessageSender`; login/configuração guiados; sessão/credenciais fora do repo e
protegidas; comando para descobrir o ID do chat; envio de teste; confirmação de entrega; FLOOD_WAIT/429; reconexão; `verify`
quando possível. **Nenhum dado real de cliente.**
**Testes:** unitários com cliente Telegram falso (sucesso, falha, timeout → `incerta`, flood wait); [WIN] envio de teste.
**Concluída quando:** mensagem de teste chega ao chat de teste e os casos de erro estão cobertos. **[WIN]:** login do Telegram,
descobrir o chat, envio de teste.

## Fase 6 — Integração, recuperação de erros e testes ponta a ponta

**Entregáveis:** orquestração completa; modo observação padrão; `live` com confirmação digitada; sessão expirada; travamentos/
quedas; encerramento limpo (Ctrl+C); recarga ociosa; métricas de memória.
**Testes:** E2E com site simulado + `FakeSender` (falhas injetadas: timeout de envio, sessão expirada, 0/N resultados, aba
travada), soak de algumas horas simuladas com relógio falso.
**Concluída quando:** E2E passam **e** [WIN] roteiro: observação → envio real para chat de teste → só então destino definitivo.
**[WIN]:** as três etapas do roteiro.

## Fase 7 — Instalação local no Windows

**Entregáveis:** `instalar.bat` (verifica Node, `npm ci`, prepara navegador) · `configurar.bat` (cria/abre `.env` e modelo) ·
`iniciar.bat` (UTF-8 `chcp 65001`, inicia o bot) · opcionais `recon.bat`, login do Telegram · `README.md` em português ·
recomendação de distribuição (ZIP do GitHub + Node instalado **vs.** ZIP gerado por Actions com Node portátil e dependências;
sem executável único) · `.bat` com CRLF.
**Testes:** CI em `windows-latest` (instalação limpa, build, testes); [WIN] instalação do zero numa pasta limpa.
**Concluída quando:** o usuário instala e inicia seguindo só o README. **[WIN]:** instalação completa e primeiro uso.
