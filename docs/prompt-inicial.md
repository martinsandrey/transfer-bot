# Prompt inicial — Transfer Bot (copiar a partir da linha abaixo)

---

Você vai atuar como engenheiro de software sênior e conduzir, **em fases e com pausas para minha aprovação**, o desenvolvimento de um programa de automação chamado **Transfer Bot**. Nesta sessão, execute **somente a FASE 1** e pare ao final dela para eu revisar.

## 0. Regras de trabalho (valem para todas as fases)

1. **Uma fase por vez.** Nunca comece a fase seguinte sem minha aprovação explícita. Ao fim de cada fase: rode os testes, faça commit, faça push no branch de desenvolvimento desta sessão, atualize `docs/PROGRESSO.md` e me entregue um relatório curto (o que foi feito, como foi testado, o que ficou pendente, perguntas abertas).
2. **Não invente nada sobre o website.** Seletores, URLs internas, endpoints, nomes de colunas além dos que eu informei, formatos de data, valores de status e comportamentos de navegação só podem entrar no código depois de **confirmados com evidência** que eu fornecer (capturas anonimizadas, HTML salvo, relatórios gerados pela ferramenta de reconhecimento descrita na Fase 2). Até lá, use interfaces, configuração e *fixtures* fictícios, e marque qualquer suposição como `TODO(confirmar)` + entrada em `docs/PERGUNTAS_ABERTAS.md`.
3. **Pergunte quando houver dúvida real.** Agrupe as perguntas (no máximo 4 por vez), explique por que cada uma importa e proponha uma resposta padrão quando houver uma razoável. Não bloqueie trabalho que não depende da resposta.
4. **Memória do projeto no repositório.** Cada sessão na nuvem começa do zero. Mantenha sempre atualizados:
   - `CLAUDE.md` — visão geral, comandos (instalar, testar, lint, rodar), convenções e regras invioláveis deste prompt (resumidas).
   - `docs/ARQUITETURA.md` — componentes, fluxo de dados, máquina de estados das chamadas e das tarefas.
   - `docs/DECISOES.md` — registro de decisões (contexto, alternativas, escolha, consequências).
   - `docs/PERGUNTAS_ABERTAS.md` — dúvidas pendentes e respostas recebidas (com data).
   - `docs/PROGRESSO.md` — status de cada fase e critérios de conclusão marcados.
5. **Ambiente.** Você está na nuvem (Linux), **sem acesso** ao website real, à minha sessão autenticada ou ao meu Telegram. O destino final é **Windows 10/11**, executado por mim localmente, sem Claude Code aberto, sem servidor externo, sem hospedagem paga. Todo código deve funcionar no Windows (caminhos, encoding, scripts `.bat`, fim de linha) e ser testável no Linux com simulações.
6. **Qualidade.** TypeScript em modo `strict`, lint e formatação automáticos, testes automatizados para toda lógica de negócio. Nenhuma fase termina com testes falhando. Prefira poucas dependências, bem mantidas e com versões fixadas (lockfile commitado). Verifique as versões atuais das bibliotecas antes de escolhê-las — não confie em memória.
7. **Segredos e dados pessoais.**
   - Nada de senhas, códigos, tokens, `api_hash`, número de telefone ou dados de clientes no código-fonte, nos testes, nos commits ou nos logs.
   - `.env` (ignorado pelo git) para configuração; `.env.example` commitado, só com placeholders.
   - Credenciais interativas (código de login do Telegram, senha 2FA) são digitadas no console no momento do uso e **nunca** gravadas em arquivo.
   - Diretórios de sessão (perfil do navegador, sessão do Telegram) ficam fora do repositório, em pasta local do usuário, e entram no `.gitignore`.
   - Logs mascaram telefones (ex.: `***1234`) e nunca registram nome, documento, endereço ou demais campos do cliente.
8. **Sem banco de dados e sem histórico local.** Proibido SQLite, arquivos JSON de histórico ou qualquer persistência das transferências. Estado operacional apenas em memória; o Telegram é o histórico. A única persistência local permitida é a de sessão (perfil do navegador e sessão do Telegram), protegida adequadamente.
9. **Segurança do website.** Uso autorizado. Não contorne login, captcha, 2FA, limites de acesso ou qualquer controle de segurança. Login é sempre manual. Se aparecer captcha/verificação, o bot pausa e me avisa.
10. **Nunca alterar cadastro de cliente.** O bot só lê. Nunca clica em Salvar/Save/Update/Delete nem equivalentes.

## 1. Objetivo

Programa para Windows que:

1. Abre uma janela de navegador **exclusiva** (perfil dedicado, sem interferir no meu navegador pessoal).
2. Permite que **eu** faça login manualmente na primeira execução e sempre que a sessão expirar.
3. Monitora continuamente uma **tabela de chamadas** que se atualiza sozinha a cada ~1 segundo (as linhas mudam de posição o tempo todo).
4. Lê de cada linha, no mínimo: `Callback Number` (identifica o **funcionário**), `Callee Number` (identifica o **cliente**), `Call Status`, `Start Time`, `Call Duration` e qualquer outro campo necessário para identificar a chamada de forma estável.
5. Mantém em memória as chamadas detectadas e as tarefas em andamento.
6. Detecta **transferência**: quando o `Call Status` de uma mesma chamada muda de `Stage 1 Agent` para `Stage 3 Agent`. Nesse momento registra o funcionário (Callback Number) e o cliente (Callee Number).
   - **Não** presuma transferência só porque a chamada atingiu 5 minutos. Existe uma "regra de cinco minutos" cujo papel exato ainda precisa ser confirmado comigo (ver perguntas abertas). Detecção de duração e confirmação de transferência são lógicas **separadas**.
7. Para cada transferência confirmada: abre a página **Customer Data List** (menu lateral esquerdo), digita o Callee Number no campo de pesquisa **Phone** (barra superior), clica em **Search**, aguarda os resultados.
   - Deve haver exatamente 1 resultado. Se houver mais de 1: emite um **alerta sonoro** no Windows e continua com o **primeiro**. Se houver 0: não envia nada, registra o erro (sem dados pessoais) e alerta.
8. Abre o botão de **edição** do cliente apenas para **ler** os campos necessários, confere que o telefone do registro corresponde ao Callee Number e fecha **sem salvar**.
9. Monta uma mensagem a partir de um **modelo que eu vou fornecer depois** (pergunte-me na fase adequada; não invente o modelo nem os campos).
10. Envia a mensagem a um **grupo específico do Telegram pela minha conta pessoal** (aparece como enviada por mim, não por bot).
11. Volta a monitorar.

## 2. Arquitetura a avaliar (não é decisão final)

- Node.js (LTS atual) + TypeScript.
- Playwright controlando Chromium/Edge com **perfil persistente dedicado** (`launchPersistentContext`, `userDataDir` próprio), janela visível.
- Telegram por conta de usuário (MTProto). Candidatas: **TDLib** via `tdl` + binários pré-compilados (`prebuilt-tdlib`), **GramJS** (pacote `telegram`, JavaScript puro), e alternativas que você encontrar. A Bot API **não** atende (mensagem precisa sair da minha conta).
- `.env` para configuração; logs estruturados com redação de campos sensíveis.
- Script `.bat` para instalar e iniciar no Windows.

Você deve comparar, justificar e registrar em `docs/DECISOES.md`. Pontos que exijo na comparação do Telegram:
- Dificuldade de compilar a TDLib no Windows (Visual Studio/MSVC, CMake, vcpkg, OpenSSL, zlib, gperf, tempo de build) versus usar binários pré-compilados; compatibilidade com a versão do Node; arquitetura x64; manutenção dos pacotes.
- Biblioteca em JavaScript puro (sem build nativo) versus TDLib: confiabilidade, confirmação de entrega (como saber que a mensagem foi realmente aceita pelo servidor), tratamento de `FLOOD_WAIT`, reconexão, formato e proteção do arquivo de sessão, login com código + 2FA via console, como descobrir o ID do grupo.
- Riscos de conta: termos de uso da API do Telegram para contas de usuário, necessidade de `api_id`/`api_hash` próprios (my.telegram.org), volume esperado de mensagens.

## 3. Requisitos de confiabilidade (projete para eles desde a Fase 1)

- Monitoramento contínuo com intervalo configurável.
- **Identidade estável de cada chamada**: descubra se existe ID de chamada (coluna, atributo `data-*`, ID na resposta de rede). Se não houver, proponha chave composta (ex.: Callback Number + Callee Number + Start Time) e trate colisões, ligações sucessivas do mesmo funcionário e linhas que somem/reaparecem. Nunca use a posição da linha como identidade.
- **Linha de base na inicialização**: chamadas já presentes quando o bot abre (inclusive já em Stage 3) são ignoradas; só transições observadas **durante** a execução geram tarefas.
- **Confirmação de transição**: exigir que o novo status seja observado de forma consistente (ex.: N leituras seguidas) antes de criar a tarefa; tratar leituras parciais da tabela durante a atualização.
- **Fila de tarefas** com estados explícitos (ex.: `detectada → na_fila → pesquisando → pronta → enviando → enviada | incerta | falhou | ignorada`), processamento **sequencial** de consultas no navegador, trava contra tarefas concorrentes e cliques repetidos, e conjunto em memória de chamadas já processadas.
- **Monitoramento não pode parar durante a consulta ao cliente**: avalie usar uma **segunda aba** no mesmo contexto para a Customer Data List enquanto a aba da tabela continua sendo lida. Se o site não permitir, documente o impacto (transições perdidas durante a consulta) e proponha mitigação.
- Esperas baseadas em condições (elemento visível, resultado carregado, requisição concluída), nunca `sleep` fixo como mecanismo principal; *timeouts* configuráveis.
- **Envio incerto** (timeout, queda de conexão após o envio): marcar como `incerta`, **não reenviar automaticamente**; verificar o histórico recente do grupo pela API quando possível e, se ainda incerto, alertar e pedir decisão manual. Não prometa eliminação absoluta de duplicatas.
- **Sessão expirada** no site: detectar (redirecionamento para login, formulário de login, respostas 401/403), pausar, alertar com som, aguardar meu login manual, retomar e **refazer a linha de base**, registrando que houve janela sem monitoramento.
- **Navegador em segundo plano**: Chromium reduz timers de abas/janelas em segundo plano ou minimizadas, o que pode atrasar a tabela. Investigue e mitigue (ex.: flags de *background throttling*, janela própria não minimizada) e documente.
- Recuperação de erros: aba travada, navegação falha, elemento ausente, Telegram desconectado — com *retries* limitados e *backoff*, sem loops infinitos de cliques.
- Execução longa (dias): vazamento de memória, recarga periódica segura da página quando ocioso, encerramento limpo com Ctrl+C.
- **Modo observação (padrão)**: detecta, consulta e monta a mensagem, mas **não envia**; mostra no console uma prévia (com dados mascarados nos logs).
- **Envio real** só com `SEND_MODE=live` no `.env` **e** confirmação explícita digitada no console a cada inicialização.
- **Proteção contra alteração de cadastro**: além de nunca clicar em botões de salvar, avalie bloquear na aba de consulta, via interceptação do Playwright, requisições de escrita (POST/PUT/PATCH/DELETE) que não sejam a própria pesquisa — somente depois de confirmar como a pesquisa é feita.
- Preferir seletores estáveis (`id`, `name`, `data-*`, papéis ARIA, rótulos/cabeçalhos de coluna). Coordenadas de tela só se não houver alternativa, e com justificativa registrada.
- Avalie também ler os dados da tabela a partir das **respostas de rede que a própria página já recebe** (XHR/fetch/WebSocket) em vez do DOM, se isso for mais estável. Isso é leitura passiva, sem chamar endpoints por conta própria e sem contornar nada; só adote após evidência.

## 4. Fases

Cada fase tem entregáveis, testes e critérios de conclusão próprios. Ao final, pare e aguarde aprovação.

### FASE 1 — Investigação, requisitos e arquitetura (execute AGORA)
- Inspecione o repositório e o ambiente da nuvem (versões de Node/npm, Playwright/Chromium disponíveis, acesso ao registro npm, limitações de rede). Registre o que encontrou.
- Pesquise versões atuais e situação de manutenção de: Playwright, opções de Telegram (TDLib/`tdl`/`prebuilt-tdlib`, GramJS e outras), biblioteca de logs, *test runner*, carregamento de `.env`, forma de tocar som no Windows.
- Escreva `docs/ARQUITETURA.md` com: componentes (Browser, TableReader, CallTracker/detector de transições, TaskQueue, CustomerLookup, MessageBuilder, TelegramClient, Notifier/som, Config, Logger), interfaces TypeScript propostas, máquinas de estado (chamada e tarefa), estratégia de identidade de chamada, estratégia de abas, estratégia de modo observação/envio real, estratégia de testes com simulação.
- Escreva `docs/DECISOES.md` com a comparação das opções de Telegram e a recomendação (sem instalar nada definitivo de Telegram ainda), e a decisão sobre Node/Playwright/navegador (Chromium do Playwright vs. Edge instalado no Windows via `channel`).
- Escreva `docs/RISCOS.md` com riscos técnicos, impacto e como cada um será investigado/mitigado.
- Escreva `docs/PERGUNTAS_ABERTAS.md` com tudo o que precisa vir de mim (ver lista abaixo) e me faça as perguntas mais bloqueantes.
- Escreva `docs/PLANO_DE_FASES.md` detalhando as Fases 2–7 com entregáveis, testes e critérios de conclusão, e indicando em quais pontos vou precisar executar algo no meu Windows.
- Escreva `docs/RECONHECIMENTO.md`: roteiro para eu coletar, no Windows, as informações do site **sem expor dados de clientes** (o que capturar, como anonimizar, como enviar ao repositório).
- Crie apenas o **esqueleto mínimo** do projeto: `package.json` com scripts (`build`, `test`, `lint`, `typecheck`), `tsconfig.json` estrito, configuração de lint/format, *test runner* com 1 teste trivial passando, `.gitignore` (incluindo `.env`, perfis, sessões, logs), `.env.example`, `.gitattributes` (fim de linha CRLF para `.bat`), `CLAUDE.md` e `docs/PROGRESSO.md`. Se viável, um workflow de CI no GitHub Actions rodando lint/typecheck/testes em `ubuntu-latest` e `windows-latest`.
- **Não** implemente leitura do site, Telegram ou fila nesta fase.

**Critérios de conclusão da Fase 1:** ver seção 6.

### FASE 2 — Navegador dedicado e leitura da tabela
- Inicialização do navegador com perfil persistente dedicado, janela visível, fluxo de login manual (detectar "não logado" → aguardar → detectar "logado"), detecção de sessão expirada.
- **Ferramenta de reconhecimento** (`npm run recon`) que eu rodo no Windows após logar: salva cabeçalhos de colunas, estrutura do DOM da tabela, atributos candidatos a seletor, URLs e formato (apenas chaves/tipos) das requisições que alimentam a tabela, e uma sequência de snapshots ao longo do tempo — **com todos os valores pessoais substituídos por marcadores**. Saída em pasta local que eu reviso antes de commitar.
- Com base nessa evidência, implemente `TableReader` que devolve linhas normalizadas e tipadas (telefones normalizados, `Start Time` com fuso definido, `Call Duration` em segundos).
- Testes: Playwright contra uma **página simulada local** que imita a estrutura confirmada, incluindo atualização a cada segundo, reordenação de linhas, linhas sumindo/aparecendo e leitura no meio da atualização.
- Concluída quando: os testes simulados passam na nuvem, e eu confirmar que no Windows o login manual funciona e a leitura real bate com o que vejo na tela (em modo somente leitura, sem logs com dados pessoais).

### FASE 3 — Monitoramento, regra de cinco minutos e fila (somente simulação)
- `CallTracker`: identidade de chamada, linha de base na inicialização, detecção da transição `Stage 1 Agent → Stage 3 Agent` com confirmação, tratamento de status intermediários/desconhecidos e da regra de cinco minutos **conforme eu definir**.
- `TaskQueue`: estados, deduplicação em memória, processamento sequencial, travas, *retries* limitados.
- Testes unitários com cenários fictícios: ligações sucessivas do mesmo funcionário, mesma chamada mudando de posição, transição perdida, chamada que já começa em Stage 3, status oscilando, reinicialização do bot, chamada que some antes de ser processada.
- Concluída quando: todos os cenários documentados têm teste passando e a regra de transferência está confirmada por mim.

### FASE 4 — Customer Data List, pesquisa e leitura do cadastro
- Navegação até Customer Data List (preferencialmente em aba separada), pesquisa por Phone, clique em Search, espera pelos resultados, tratamento de 0/1/várias linhas (som + primeiro resultado), abertura da edição, leitura dos campos definidos por mim, verificação de que o telefone corresponde ao Callee Number, fechamento **sem salvar**.
- Bloqueios de segurança contra escrita e contra cliques repetidos.
- Pergunte-me nesta fase: **modelo exato da mensagem**, campos a extrair e quais deles podem ser compartilhados no grupo.
- Testes contra página simulada; validação real em modo observação no meu Windows.

### FASE 5 — Telegram pela conta pessoal
- Implemente a opção escolhida na Fase 1. Login interativo no console (telefone, código, 2FA), sessão salva fora do repositório com proteção adequada, comando para listar meus grupos e descobrir o ID, comando de envio de teste para um chat de teste (ex.: "Mensagens Salvas"), confirmação de entrega, tratamento de `FLOOD_WAIT` e reconexão.
- `MessageBuilder` a partir do modelo aprovado; testes com dados fictícios.
- Nenhum dado real de cliente é enviado nesta fase.

### FASE 6 — Integração, recuperação de erros e testes ponta a ponta
- Orquestração completa, modo observação como padrão, ativação do envio real com confirmação, recuperação de sessão expirada, travamentos e quedas, encerramento limpo.
- Teste ponta a ponta com site simulado + cliente Telegram simulado. Depois, roteiro de validação no meu Windows: primeiro em observação, depois envio real para um grupo de teste, só então para o grupo definitivo.

### FASE 7 — Instalação local no Windows
- `instalar.bat` (verifica Node, instala dependências, prepara navegador), `iniciar.bat` (console em UTF-8, inicia o bot), opcional `login-telegram.bat` e `recon.bat`.
- Avalie e recomende a forma de distribuição mais simples e confiável: clonar/baixar o ZIP do GitHub + Node instalado, versus pacote ZIP gerado por GitHub Actions contendo Node portátil e dependências. Evite empacotar em executável único se isso complicar Playwright ou bibliotecas nativas.
- `README.md` em português: pré-requisitos, instalação, configuração do `.env`, primeiro login no site, login no Telegram, modo observação, ativação do envio real, como atualizar, como parar, solução de problemas comuns (antivírus, Node ausente, porta/janela fechada, sessão expirada, FLOOD_WAIT, encoding do console, navegador minimizado).

## 5. Informações que ainda dependem de mim (registre em `docs/PERGUNTAS_ABERTAS.md`)

- URL do sistema e da página da tabela; se o login tem 2FA/captcha; duração típica da sessão.
- Evidência da estrutura da tabela e da Customer Data List (via roteiro de reconhecimento).
- Todos os valores possíveis de `Call Status` e a sequência normal de uma chamada; existência de Stage 2; se uma chamada pode voltar de Stage 3 para Stage 1.
- O papel exato da "regra de cinco minutos" e qual campo usar (`Call Duration` ou `Start Time`).
- Se existe ID único de chamada; formato e fuso de `Start Time`; formato de `Call Duration`; formato dos telefones (DDI, máscara).
- Se a tabela mostra todas as chamadas ou é paginada/filtrada; o que acontece com a linha quando a chamada termina.
- Se é possível abrir Customer Data List em outra aba mantendo a tabela aberta.
- Campos a ler na edição do cliente, modelo da mensagem e quais dados podem ir para o grupo.
- Grupo de destino do Telegram (e grupo de teste), volume esperado de mensagens por dia.
- Mapeamento funcionário ↔ Callback Number, se a mensagem precisar do nome do funcionário.
- Versão do Windows, se o Node já está instalado, se posso usar o Edge já instalado, restrições de antivírus/proxy corporativo.

## 6. Critérios de conclusão da FASE 1

A Fase 1 só está concluída quando:

1. Existem e estão coerentes: `CLAUDE.md`, `docs/ARQUITETURA.md`, `docs/DECISOES.md`, `docs/RISCOS.md`, `docs/PERGUNTAS_ABERTAS.md`, `docs/PLANO_DE_FASES.md`, `docs/RECONHECIMENTO.md`, `docs/PROGRESSO.md`, `.env.example`, `.gitignore`, `.gitattributes`.
2. A comparação de opções de Telegram cobre build no Windows, dependências nativas, confirmação de entrega, sessão, manutenção e riscos de conta, com recomendação justificada e plano B.
3. A arquitetura descreve identidade de chamada, linha de base, confirmação de transição, máquina de estados das tarefas, estratégia de abas, deduplicação em memória, envio incerto, sessão expirada e modo observação.
4. Nenhum seletor, URL ou comportamento do site foi inventado; toda suposição está marcada como pendente.
5. O esqueleto instala com `npm ci`, e `npm run lint`, `npm run typecheck` e `npm test` passam na nuvem.
6. Nenhum segredo ou dado pessoal foi commitado.
7. As perguntas bloqueantes foram feitas para mim e o roteiro de reconhecimento está pronto para eu executar no Windows.
8. Commit e push feitos; relatório final entregue; você **parou** e aguarda minha aprovação para a Fase 2.

Comece agora pela Fase 1.
