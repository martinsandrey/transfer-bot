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
7. **Configuração fácil de alterar.** A **URL do sistema muda com frequência**, assim como usuário e senha. Tudo que pode mudar fica em configuração externa (`.env` e/ou arquivo de configuração simples), nunca no código, e deve poder ser alterado por mim sem recompilar e sem conhecimento técnico (ex.: editar um arquivo de texto ou rodar um `configurar.bat`). Valide a configuração na inicialização e mostre mensagens de erro claras em português.
8. **Segredos e dados pessoais.**
   - Nada de senhas, códigos, tokens, `api_hash`, número de telefone ou dados de clientes no código-fonte, nos testes, nos commits ou nos logs.
   - `.env` (ignorado pelo git) para configuração e credenciais do site; `.env.example` commitado, só com placeholders. Avalie se vale guardar a senha do site no Gerenciador de Credenciais do Windows em vez do `.env`; se a complexidade não compensar, use o `.env` e documente o cuidado necessário.
   - Códigos de verificação (2FA, Telegram) são digitados no console no momento do uso e **nunca** gravados em arquivo.
   - Diretórios de sessão (perfil do navegador, sessão do Telegram) ficam fora do repositório, em pasta local do usuário, e entram no `.gitignore`.
   - Logs mascaram telefones (ex.: `***1234`) e CPF, e nunca registram nome, CPF, localização, idade ou demais campos do cliente.
9. **Sem banco de dados e sem histórico local.** Proibido SQLite, arquivos JSON de histórico ou qualquer persistência das transferências. Estado operacional apenas em memória; o Telegram é o histórico. A única persistência local permitida é a de sessão (perfil do navegador e sessão do Telegram) e a configuração, protegidas adequadamente.
10. **Segurança do website.** Uso autorizado. Não contorne captcha, 2FA, limites de acesso ou qualquer controle de segurança. O login automático apenas preenche o formulário com as credenciais que eu configurei, como eu faria manualmente. Se aparecer captcha/verificação ou o login falhar, o bot **não** fica tentando: pausa, avisa com som e espera que eu faça o login manualmente.
11. **Nunca alterar cadastro de cliente.** O bot só lê. Nunca clica em Salvar/Save/Update/Delete nem equivalentes.

## 1. Objetivo

Programa para Windows que:

1. Abre uma janela de navegador **exclusiva** (perfil dedicado, sem interferir no meu navegador pessoal), na URL configurada.
2. Faz login no site usando usuário e senha configurados; se não estiverem configurados, se houver captcha/2FA ou se o login falhar, permite que **eu** faça login manualmente. O mesmo vale quando a sessão expirar.
3. Monitora continuamente uma **tabela de chamadas** que se atualiza sozinha a cada ~1 segundo (as linhas mudam de posição o tempo todo).
4. Lê de cada linha, no mínimo: `Callback Number`, `Callee Number` (identifica o **cliente**), `Call Status`, `Start Time`, `Call Duration` e qualquer outro campo necessário.
5. **Identifica cada chamada a partir do `Callback Number`.** Cada funcionário faz **uma ligação por vez**, então um mesmo Callback Number **nunca aparece em duas linhas ao mesmo tempo**, mas **se repete várias vezes ao longo do dia** (ligações sucessivas do mesmo funcionário). Portanto:
   - Use o Callback Number para localizar a chamada atual daquele funcionário na tabela, independentemente da posição da linha.
   - A identidade de uma **ocorrência de chamada** é o Callback Number **mais** algo que distinga ligações sucessivas (ex.: `Start Time` e/ou `Callee Number`; confirmar com a evidência da Fase 2). Quando o mesmo Callback Number passa a mostrar outro `Start Time`/`Callee Number`, ou some e reaparece, trata-se de **uma nova chamada**, com estado próprio.
   - A deduplicação é por ocorrência de chamada, **nunca** só pelo Callback Number; caso contrário, a segunda transferência do mesmo funcionário no dia seria ignorada.
   - Se, contra a regra, o mesmo Callback Number aparecer em duas linhas ao mesmo tempo, trate como anomalia: registre no log (sem dados pessoais), não gere tarefa a partir dessas linhas e me avise.
6. Mantém em memória as chamadas detectadas e as tarefas em andamento.
7. Detecta **transferência**: quando o `Call Status` de uma mesma chamada muda de `Stage 1 Agent` para `Stage 3 Agent`. Nesse momento registra o Callback Number e o Callee Number.
   - Existe também `Stage 2 Agent`. A partir do Stage 1, a chamada vai **ou** para Stage 2 **ou** para Stage 3; **nunca** de Stage 2 para Stage 3.
     - `Stage 1 → Stage 2`: não é do meu interesse; **não faça nada**.
     - `Stage 1 → Stage 3`: **é uma transferência**; gere a tarefa.
     - Qualquer outra sequência (ex.: `Stage 2 → Stage 3`) é inesperada: não gere tarefa, registre no log e me avise.
   - Não há regra de tempo/duração para considerar uma transferência: o critério é exclusivamente a mudança de status.
   - Chamada observada pela primeira vez **já em Stage 3** durante a execução (a transição pode ter ocorrido entre duas leituras): **não gere tarefa**; apenas registre no log (sem dados pessoais) e emita um aviso, para evitar falso positivo.
8. Para cada transferência confirmada: abre a página **Customer Data List** (menu lateral esquerdo), digita o Callee Number no campo de pesquisa **Phone** (barra superior), clica em **Search** e aguarda os resultados.
   - Deve haver exatamente 1 resultado. Se houver mais de 1: emite um **alerta sonoro** no Windows e continua com o **primeiro**. Se houver 0: não envia nada, registra o erro (sem dados pessoais) e alerta.
   - Navegue pelo menu e pela interface, sem depender de URLs internas fixas, já que a URL base muda com frequência.
9. Abre o botão de **edição** do cliente apenas para **ler** os campos necessários, confere que o telefone do registro corresponde ao Callee Number e fecha **sem salvar**.
10. Monta a mensagem no **modelo abaixo** (exatamente este texto, com quebras de linha, espaços e rótulos preservados):

    ```
    NAME: {{nome}}
    CPF : {{cpf}}
    Location: {{location}}
    Age: {{age}}
    Occupation: 
    Ph: {{Phone}}
    Line 1 number: {{callback number}}
    NOTE:
    ```

    - `Occupation:` e `NOTE:` ficam **em branco** (texto fixo, para preenchimento manual depois).
    - `{{callback number}}` vem da tabela de chamadas; os demais placeholders vêm do cadastro do cliente.
    - O modelo deve ficar em um arquivo de texto editável (ex.: `config/mensagem.txt`), carregado na inicialização, com validação de placeholders desconhecidos ou ausentes.
    - Os valores são **copiados literalmente** dos campos correspondentes do formulário de edição, sem cálculo, formatação ou validação de conteúdo: o que estiver no campo `age` vai para `{{age}}`, o que estiver no campo `location` vai para `{{location}}`, e assim por diante para nome e CPF. Apenas remova espaços nas extremidades.
    - `{{Phone}}`: o telefone do cadastro é sempre igual ao Callee Number. Use o valor do cadastro e confira (após normalizar dígitos) que ele bate com o Callee Number; se não bater, isso indica cliente errado: não envie, alerte e registre no log sem dados pessoais.
    - Quais rótulos/seletores do formulário correspondem a cada placeholder será confirmado com a evidência da Fase 4.
11. Envia a mensagem ao Telegram. **A forma de integração com o Telegram (conta pessoal, bot, grupo etc.) ainda será definida por mim.** Até lá, o envio fica atrás de uma interface (`MessageSender`) com implementação de console/simulação.
12. Volta a monitorar.

## 2. Arquitetura a avaliar (não é decisão final)

- Node.js (LTS atual) + TypeScript.
- Playwright controlando Chromium/Edge com **perfil persistente dedicado** (`launchPersistentContext`, `userDataDir` próprio), janela visível.
- Envio ao Telegram desacoplado por interface. Na Fase 1, apenas **levante** as opções e seus trade-offs para eu decidir depois: conta pessoal via MTProto (TDLib via `tdl` + `prebuilt-tdlib`; GramJS, pacote `telegram`, JavaScript puro) e Bot API. Pontos a cobrir: dificuldade de compilar a TDLib no Windows (MSVC, CMake, vcpkg, OpenSSL, zlib, gperf) versus binários pré-compilados; dependências nativas; confirmação de entrega; `FLOOD_WAIT`; arquivo de sessão e sua proteção; necessidade de `api_id`/`api_hash`; mensagem aparecendo como minha versus como bot; riscos à conta. **Não instale nem implemente Telegram até eu definir.**
- `.env` + arquivo de modelo de mensagem para configuração; logs estruturados com redação de campos sensíveis.
- Script `.bat` para instalar, configurar e iniciar no Windows.

Registre comparações e escolhas em `docs/DECISOES.md`.

## 3. Requisitos de confiabilidade (projete para eles desde a Fase 1)

- Monitoramento contínuo com intervalo configurável.
- **Identidade da chamada pelo Callback Number + distinção de ligações sucessivas** (ver item 1.5). Nunca use a posição da linha como identidade.
- **Linha de base na inicialização**: chamadas já presentes quando o bot abre (inclusive já em Stage 3) são ignoradas; só transições `Stage 1 → Stage 3` observadas **durante** a execução geram tarefas.
- **Confirmação de transição**: exigir que o novo status seja observado de forma consistente (ex.: N leituras seguidas, configurável) antes de criar a tarefa; tratar leituras parciais da tabela durante a atualização.
- **Fila de tarefas** com estados explícitos (ex.: `detectada → na_fila → pesquisando → pronta → enviando → enviada | incerta | falhou | ignorada`), processamento **sequencial** de consultas no navegador, trava contra tarefas concorrentes e cliques repetidos, e conjunto em memória das ocorrências de chamada já processadas (com limpeza periódica das antigas para não crescer indefinidamente).
- **Monitoramento não pode parar durante a consulta ao cliente**: avalie usar uma **segunda aba** no mesmo contexto para a Customer Data List enquanto a aba da tabela continua sendo lida. Se o site não permitir, documente o impacto (transições perdidas durante a consulta) e proponha mitigação.
- Esperas baseadas em condições (elemento visível, resultado carregado, requisição concluída), nunca `sleep` fixo como mecanismo principal; *timeouts* configuráveis.
- **Envio incerto** (timeout, queda de conexão após o envio): marcar como `incerta`, **não reenviar automaticamente**; verificar quando possível e, se ainda incerto, alertar e pedir decisão manual. Não prometa eliminação absoluta de duplicatas.
- **Sessão expirada** no site: detectar (redirecionamento para login, formulário de login, respostas 401/403), pausar, tentar o login configurado **uma vez**, e se não der certo alertar com som e aguardar meu login manual; depois retomar e **refazer a linha de base**, registrando que houve janela sem monitoramento.
- **Troca de URL**: ao mudar a URL na configuração e reiniciar, o bot deve funcionar sem outras alterações (o perfil do navegador pode precisar de novo login, o que é aceitável).
- **Navegador em segundo plano**: Chromium reduz timers de abas/janelas em segundo plano ou minimizadas, o que pode atrasar a tabela. Investigue e mitigue (ex.: flags de *background throttling*, janela própria não minimizada) e documente.
- Recuperação de erros: aba travada, navegação falha, elemento ausente, envio falho — com *retries* limitados e *backoff*, sem loops infinitos de cliques nem de tentativas de login.
- Execução longa (dias): vazamento de memória, recarga periódica segura da página quando ocioso, encerramento limpo com Ctrl+C.
- **Modo observação (padrão)**: detecta, consulta e monta a mensagem, mas **não envia**; mostra no console uma prévia (os logs em arquivo continuam mascarados).
- **Envio real** só com configuração explícita (ex.: `SEND_MODE=live`) **e** confirmação digitada no console a cada inicialização.
- **Proteção contra alteração de cadastro**: além de nunca clicar em botões de salvar, avalie bloquear na aba de consulta, via interceptação do Playwright, requisições de escrita (POST/PUT/PATCH/DELETE) que não sejam a própria pesquisa — somente depois de confirmar como a pesquisa é feita.
- Preferir seletores estáveis (`id`, `name`, `data-*`, papéis ARIA, rótulos/cabeçalhos de coluna, textos de menu). Coordenadas de tela só se não houver alternativa, e com justificativa registrada.
- Avalie também ler os dados da tabela a partir das **respostas de rede que a própria página já recebe** (XHR/fetch/WebSocket) em vez do DOM, se isso for mais estável. Isso é leitura passiva, sem chamar endpoints por conta própria e sem contornar nada; só adote após evidência.

## 4. Fases

Cada fase tem entregáveis, testes e critérios de conclusão próprios. Ao final, pare e aguarde aprovação.

### FASE 1 — Investigação, requisitos e arquitetura (execute AGORA)
- Inspecione o repositório e o ambiente da nuvem (versões de Node/npm, Playwright/Chromium disponíveis, acesso ao registro npm, limitações de rede). Registre o que encontrou.
- Pesquise versões atuais e situação de manutenção de: Playwright, biblioteca de logs, *test runner*, carregamento/validação de configuração, forma de tocar som no Windows, armazenamento de credenciais no Windows; e levante as opções de Telegram (sem decidir).
- Escreva `docs/ARQUITETURA.md` com: componentes (Browser, LoginManager, TableReader, CallTracker/detector de transições, TaskQueue, CustomerLookup, MessageBuilder, MessageSender, Notifier/som, Config, Logger), interfaces TypeScript propostas, máquinas de estado (chamada e tarefa), identidade de chamada (Callback Number + distinção de ligações sucessivas) e tratamento de anomalias, estratégia de abas, login automático com *fallback* manual, modo observação/envio real, estratégia de testes com simulação.
- Escreva `docs/DECISOES.md` com as decisões sobre Node/Playwright/navegador (Chromium do Playwright vs. Edge instalado no Windows via `channel`), configuração/credenciais e o levantamento das opções de Telegram (marcado como **pendente da minha decisão**).
- Escreva `docs/RISCOS.md` com riscos técnicos, impacto e como cada um será investigado/mitigado.
- Escreva `docs/PERGUNTAS_ABERTAS.md` com tudo o que precisa vir de mim (ver seção 5) e me faça as perguntas mais bloqueantes.
- Escreva `docs/PLANO_DE_FASES.md` detalhando as Fases 2–7 com entregáveis, testes e critérios de conclusão, indicando em quais pontos vou precisar executar algo no meu Windows.
- Escreva `docs/RECONHECIMENTO.md`: roteiro para eu coletar, no Windows, as informações do site **sem expor dados de clientes** (o que capturar, como anonimizar, como enviar ao repositório).
- Crie apenas o **esqueleto mínimo** do projeto: `package.json` com scripts (`build`, `test`, `lint`, `typecheck`), `tsconfig.json` estrito, configuração de lint/format, *test runner* com 1 teste trivial passando, `.gitignore` (incluindo `.env`, perfis, sessões, logs, saídas de reconhecimento), `.env.example`, `config/mensagem.txt` com o modelo acima, `.gitattributes` (CRLF para `.bat`), `CLAUDE.md` e `docs/PROGRESSO.md`. Se viável, um workflow de CI no GitHub Actions rodando lint/typecheck/testes em `ubuntu-latest` e `windows-latest`.
- **Não** implemente leitura do site, login, fila ou Telegram nesta fase.

**Critérios de conclusão da Fase 1:** ver seção 6.

### FASE 2 — Navegador dedicado, login e leitura da tabela
- Inicialização do navegador com perfil persistente dedicado, janela visível, URL vinda da configuração.
- `LoginManager`: detectar "não logado" → preencher credenciais configuradas (uma tentativa) → detectar "logado"; *fallback* para login manual com aviso sonoro; detecção de sessão expirada. Seletores do formulário de login só após evidência.
- **Ferramenta de reconhecimento** (`npm run recon`) que eu rodo no Windows após logar: salva cabeçalhos de colunas, estrutura do DOM da tabela, atributos candidatos a seletor, URLs relativas e formato (apenas chaves/tipos) das requisições que alimentam a tabela, todos os valores distintos de `Call Status`, e uma sequência de snapshots ao longo do tempo — **com todos os valores pessoais substituídos por marcadores**. Saída em pasta local que eu reviso antes de commitar.
- Com base nessa evidência, implemente `TableReader` que devolve linhas normalizadas e tipadas (telefones normalizados, `Start Time` com fuso definido, `Call Duration` em segundos).
- Testes: Playwright contra uma **página simulada local** que imita a estrutura confirmada, incluindo atualização a cada segundo, reordenação de linhas, linhas sumindo/aparecendo, leitura no meio da atualização e expiração de sessão.
- Concluída quando: os testes simulados passam na nuvem, e eu confirmar no Windows que o login (automático e manual) funciona e que a leitura real bate com o que vejo na tela, sem logs com dados pessoais.

### FASE 3 — Monitoramento e fila (somente simulação)
- `CallTracker`: identidade por Callback Number com separação de ligações sucessivas do mesmo funcionário, detecção de anomalias, linha de base na inicialização, detecção da transição `Stage 1 Agent → Stage 3 Agent` com confirmação, descarte de `Stage 1 → Stage 2`, tratamento de sequências inesperadas e status desconhecidos, e do caso "visto pela primeira vez em Stage 3" (sem tarefa, apenas aviso).
- `TaskQueue`: estados, deduplicação em memória, processamento sequencial, travas, *retries* limitados.
- Testes unitários com cenários fictícios: mesma chamada mudando de posição, Stage 1 → Stage 2 (ignorar), Stage 1 → Stage 3 (tarefa), Stage 2 → Stage 3 (inesperado: sem tarefa, com aviso), chamada vista pela primeira vez em Stage 3 (sem tarefa, com aviso), status oscilando, transição entre duas leituras, **mesmo funcionário com duas transferências no mesmo dia (duas tarefas distintas)**, mesmo Callback Number em duas linhas simultâneas (anomalia), reinicialização do bot, chamada que some antes de ser processada.
- Concluída quando: todos os cenários documentados têm teste passando.

### FASE 4 — Customer Data List, pesquisa, leitura do cadastro e mensagem
- Navegação até Customer Data List pelo menu (preferencialmente em aba separada), pesquisa por Phone, clique em Search, espera pelos resultados, tratamento de 0/1/várias linhas (som + primeiro resultado), abertura da edição, leitura dos campos, verificação de que o telefone corresponde ao Callee Number, fechamento **sem salvar**.
- Bloqueios de segurança contra escrita e contra cliques repetidos.
- `MessageBuilder` com o modelo de `config/mensagem.txt`, copiando literalmente os valores dos campos do formulário; confirme comigo apenas quais rótulos do formulário correspondem a `nome`, `cpf`, `location`, `age` e `Phone`, com base na evidência capturada.
- Testes contra página simulada e testes unitários do modelo (texto exato, campos vazios, caracteres especiais); validação real em modo observação no meu Windows, com a prévia apenas no console.

### FASE 5 — Integração com o Telegram
- **Só começa depois que eu definir a forma de integração** (conta pessoal, bot, grupo de destino etc.). Implemente então a opção escolhida atrás da interface `MessageSender`, com: login/configuração guiados, sessão/credenciais fora do repositório e protegidas, comando para descobrir o ID do chat de destino, envio de teste para um chat de teste, confirmação de entrega, tratamento de limites de envio e reconexão.
- Nenhum dado real de cliente é enviado nesta fase.

### FASE 6 — Integração, recuperação de erros e testes ponta a ponta
- Orquestração completa, modo observação como padrão, ativação do envio real com confirmação, recuperação de sessão expirada, travamentos e quedas, encerramento limpo.
- Teste ponta a ponta com site simulado + `MessageSender` simulado. Depois, roteiro de validação no meu Windows: primeiro em observação, depois envio real para um chat de teste, só então para o destino definitivo.

### FASE 7 — Instalação local no Windows
- `instalar.bat` (verifica Node, instala dependências, prepara navegador), `configurar.bat` (cria/abre o `.env` e o modelo de mensagem para edição), `iniciar.bat` (console em UTF-8, inicia o bot), e opcionais `recon.bat` e scripts de login do Telegram, se aplicável.
- Avalie e recomende a forma de distribuição mais simples e confiável: clonar/baixar o ZIP do GitHub + Node instalado, versus pacote ZIP gerado por GitHub Actions contendo Node portátil e dependências. Evite empacotar em executável único se isso complicar Playwright ou bibliotecas nativas.
- `README.md` em português: pré-requisitos, instalação, como trocar URL/usuário/senha, como editar o modelo de mensagem, primeiro login, modo observação, ativação do envio real, como atualizar, como parar, solução de problemas comuns (antivírus, Node ausente, janela fechada, sessão expirada, login falhando, encoding do console, navegador minimizado).

## 5. Informações que ainda dependem de mim (registre em `docs/PERGUNTAS_ABERTAS.md`)

Já respondido:
- Regra de cinco minutos: **descartada**; não existe critério de tempo.
- Stage 2 existe; transferências para Stage 2 **não** geram tarefa. Só `Stage 1 Agent → Stage 3 Agent` interessa.
- Identidade da chamada: **Callback Number**. Nunca aparece em duas linhas ao mesmo tempo (1 ligação por funcionário), mas se repete várias vezes por dia.
- Fluxo de status: Stage 1 vai **ou** para Stage 2 (ignorar) **ou** para Stage 3 (transferência). Nunca Stage 2 → Stage 3.
- Chamada vista pela primeira vez já em Stage 3: **não gera tarefa**, apenas aviso.
- Campos da mensagem: copiar literalmente o conteúdo dos campos do cadastro (`age`, `location` etc.), sem interpretar. Telefone do cadastro = Callee Number, sempre.
- URL, usuário e senha: **configuráveis**, a URL muda com frequência.
- Modelo da mensagem: definido (seção 1, item 10).

Ainda pendente:
- Se o login tem 2FA/captcha; duração típica da sessão.
- Evidência da estrutura da tabela, do login e da Customer Data List (via roteiro de reconhecimento).
- Todos os valores possíveis de `Call Status` (além dos três Stages) e se Stage 3 pode voltar para Stage 1.
- Qual campo distingue com segurança ligações sucessivas do mesmo Callback Number (`Start Time`? ID oculto?).
- Formato e fuso de `Start Time`; formato de `Call Duration` e dos telefones (DDI, máscara).
- Se a tabela é paginada/filtrada; o que acontece com a linha quando a chamada termina.
- Se a Customer Data List pode ser aberta em outra aba sem derrubar a tabela.
- Rótulos dos campos do formulário de edição que correspondem a `nome`, `cpf`, `location`, `age` e `Phone` (via evidência).
- Forma de integração com o Telegram, destino e volume de mensagens (definirei depois).
- Versão do Windows, se o Node já está instalado, se posso usar o Edge, restrições de antivírus/proxy.

## 6. Critérios de conclusão da FASE 1

A Fase 1 só está concluída quando:

1. Existem e estão coerentes: `CLAUDE.md`, `docs/ARQUITETURA.md`, `docs/DECISOES.md`, `docs/RISCOS.md`, `docs/PERGUNTAS_ABERTAS.md`, `docs/PLANO_DE_FASES.md`, `docs/RECONHECIMENTO.md`, `docs/PROGRESSO.md`, `.env.example`, `config/mensagem.txt`, `.gitignore`, `.gitattributes`.
2. A arquitetura descreve: identidade por Callback Number com separação de ligações sucessivas e deduplicação por ocorrência de chamada, tratamento de anomalias, linha de base, confirmação da transição Stage 1 → Stage 3 e descarte de Stage 1 → Stage 2, máquina de estados das tarefas, estratégia de abas, login automático com *fallback* manual, configuração alterável sem recompilar, deduplicação em memória, envio incerto, sessão expirada e modo observação.
3. O levantamento das opções de Telegram está pronto para minha decisão, sem nada instalado ou implementado.
4. Nenhum seletor, URL ou comportamento do site foi inventado; toda suposição está marcada como pendente.
5. O esqueleto instala com `npm ci`, e `npm run lint`, `npm run typecheck` e `npm test` passam na nuvem.
6. Nenhum segredo ou dado pessoal foi commitado.
7. As perguntas bloqueantes foram feitas para mim e o roteiro de reconhecimento está pronto para eu executar no Windows.
8. Commit e push feitos; relatório final entregue; você **parou** e aguarda minha aprovação para a Fase 2.

Comece agora pela Fase 1.
