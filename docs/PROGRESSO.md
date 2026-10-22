# Progresso

| Fase                                        | Situação                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1 — Investigação, requisitos e arquitetura  | **Aprovada**                                                                                              |
| 2 — Navegador, login e leitura da tabela    | **Em andamento — parada intermediária (aguardando a saída do `npm run recon`)**                           |
| 3 — Monitoramento e fila (simulação)        | **Adiantada** (autorização do usuário em 2026-10-15): CallTracker, TaskQueue e todos os cenários testados |
| 4 — Customer Data List, cadastro e mensagem | Parcial: `MessageBuilder` pronto; consulta real aguarda evidência                                         |
| 5 — Telegram                                | Bloqueada (decisão do usuário pendente)                                                                   |
| 6 — Integração e E2E                        | Parcial: laço de monitoramento, modo simulado e recuperação de sessão testados                            |
| 7 — Instalação no Windows                   | Parcial: `.bat` e README escritos (não testados no Windows)                                               |

## Fase 1 — critérios de conclusão

- [x] CLAUDE.md, ARQUITETURA, DECISOES, RISCOS, PERGUNTAS_ABERTAS, PLANO_DE_FASES, RECONHECIMENTO, PROGRESSO
- [x] `.env.example`, `config/mensagem.txt`, `.gitignore`, `.gitattributes`
- [x] Arquitetura cobre identidade/ocorrência, anomalias, linha de base, confirmação, 1→2 descartado, estados da tarefa, abas, login, config, dedup, envio incerto, sessão expirada, modo observação
- [x] Opções de Telegram levantadas (nada instalado/implementado)
- [x] Nenhum seletor/URL/comportamento do site inventado (suposições em PERGUNTAS_ABERTAS)
- [x] `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` passam na nuvem
- [x] Nenhum segredo/dado pessoal commitado
- [x] Perguntas bloqueantes feitas; roteiro de reconhecimento pronto
- [x] Commit e push feitos; parada para aprovação
- [ ] CI (GitHub Actions) verde em ubuntu e windows — **não verificado**: o workflow foi criado, mas ainda não foi observado rodando

## Fase 2 — andamento (2026-10-15)

Parada intermediária (prevista no PLANO_DE_FASES): o `TableReader` e os seletores/sinais de login **dependem da evidência** do `recon`.

Feito (parte 1, sem depender do site): `Config` (zod, `.env`, erros em português), `Logger` (pino, allow-list, máscara de telefone/CPF/e-mail),
`Notificador` (PowerShell no Windows, BEL nos demais), `BrowserHost` (perfil persistente, flags anti-throttling, `msedge`/`chromium`),
`GerenciadorLogin` (1 tentativa automática, fallback manual com aviso sonoro, espera cancelável; o adaptador do site fica para depois da evidência),
ferramenta **`npm run recon`** (anonimização por marcadores estáveis, observador de rede passivo, série temporal + análise de identidade/transições, monitor de abas, varredura de PII).
Testes: 26 passando (unitários + integração com Chromium contra site simulado fictício).

Pendente (parte 2, depois da evidência): adaptador de login real, `TableReader` tipado, normalização de `Start Time`/`Call Duration`, página simulada fiel à estrutura confirmada,
testes de expiração de sessão, confirmação no Windows (login automático e manual, leitura bate com a tela, logs sem PII, som, janela minimizada).

## Trabalho adiantado sem evidência do site (2026-10-15)

O usuário não pode rodar o `recon` por ora e pediu para programar o máximo possível. Feito (tudo testado com dados fictícios; **84 testes**):

- **`CallTracker`** (Fase 3): ocorrência = Callback Number + discriminador; linha de base; confirmação de N leituras; 1→3 gera tarefa, 1→2 ignorada,
  2→3 e 3→1 inesperadas (aviso), primeira vez em Stage 3 (aviso), status desconhecido, callback duplicado (anomalia), janela sem leitura, reinício de baseline, TTL.
  Cenários cobertos: ver `tests/call-tracker.test.ts` (24 testes).
- **`TaskQueue`** (Fase 3): estados e transições validadas, dedup, sequencial com trava, retries limitados, envio incerto sem reenvio automático, `verify`, decisão manual, limpeza (16 testes).
- **`MessageBuilder`** (Fase 4): validação de placeholders, cópia literal, `config/mensagem.txt` (4 testes).
- **`Monitor`** (Fase 6): laço, consulta em segundo plano sem parar a leitura, sessão expirada → login + nova base, alertas (6 testes).
- **`LeitorTabelaHtml`**: lê a tabela pelos **cabeçalhos informados** (ver suposições abaixo).
- **Modo simulado** (`npm run simular`) e teste ponta a ponta do cenário fictício.
- **Windows** (Fase 7 parcial): `instalar.bat`, `configurar.bat`, `iniciar.bat`, `simular.bat`, `recon.bat` (CRLF, **não testados no Windows**) e `README.md`.

**Suposições provisórias (todas `TODO(confirmar)`, ver PERGUNTAS_ABERTAS):** discriminador padrão = `Start Time|Callee Number` (texto cru); a tabela é HTML/ARIA com os cabeçalhos informados;
`Call Duration` em `SS`, `MM:SS` ou `HH:MM:SS`; "logado" = tabela de chamadas visível; sessão expirada = tabela ausente por vários segundos.

**Não feito (depende de evidência ou decisão):** login automático, `CustomerLookup` real (menu/pesquisa/edição), Telegram, `SEND_MODE=live` (recusado de propósito).

## Primeira evidência real do site (2026-10-16)

O usuário rodou o `recon` no Windows (comando `tabela`). Resultado registrado em `docs/EVIDENCIAS.md`. Correções feitas por causa dela (**104 testes**):

- **Leitor**: erro "linha com número de células diferente" — o cabeçalho tem um 8º item de resumo que as linhas (7 células) não têm. Alinhamento agora por posição do cabeçalho.
- **Status**: `Stage 1 Ringing` e `Stage 1 Manual Call` existem; `Ringing → Agent` geraria avisos falsos a cada chamada. O rastreador agora lê `Stage N <complemento>`.
- Simulação, site simulado e testes atualizados para a estrutura confirmada.

**Pendente e bloqueante:** Q1 (o que acontece com o Callback Number na transferência) — ver PERGUNTAS_ABERTAS.

## Linhas com dado faltando (2026-10-16)

Regra do usuário aplicada: a linha com dado faltando é ignorada individualmente, sem parar o sistema (leitor, rastreador e monitor; **107 testes**).

## Mensagem exibida no console (2026-10-16)

Pedido do usuário: enquanto o Telegram não está conectado, ao detectar uma transferência o programa prepara a mensagem do modelo e a mostra no console (`npm start`).
Como a consulta ao cadastro ainda depende de evidência (Customer Data List), a mensagem sai só com `Ph` (= Callee Number) e `Line 1 number` (= Callback Number); NAME/CPF/Location/Age em branco, com aviso no console.
Implementado com `BuscaSemCadastro` (provisório) + `TaskQueue` em modo observação. 109 testes (inclui ponta a ponta na estrutura confirmada pelo recon).

## Capturas `clientes`/`resultado`/`edicao` (2026-10-16)

Chegaram, mas mostram a tela de monitoramento (não a Customer Data List). Aprendido: a **tabela de chamadas fica num iframe** (`/modules/cc_monitor/curcall_in.php`), o menu é uma árvore dhtmlx e há uma tabela de saída (`curcall_out.php`) que não nos interessa (detalhes em `docs/EVIDENCIAS.md`).
Recon melhorado: `menu`, `clientes`, `resultado` e `edicao` capturam **todas as abas abertas**; tabelas só de layout são omitidas. Perguntas R1/R2 abertas.

## Transferência por troca de linha (2026-10-16)

Teste real do usuário: **nenhuma transferência detectada** (só avisos de "primeira vez em Stage 3"). Causa: a transferência é a linha do Stage 1 sumir e surgir outra em Stage 3 com outro Callback Number e o mesmo Callee.
Corrigido: o rastreador liga as duas linhas pelo **Callee Number** (janela configurável, N leituras de confirmação), usa o Callback do Stage 1 como `Line 1 number` e não repete avisos para a mesma chamada de Stage 3. **121 testes.**
Console do modo real simplificado: só avisos em português (com hora) e a mensagem preparada; o detalhe técnico vai para o arquivo de log.

## Consulta ao cadastro — lógica pronta, página pendente (2026-10-16)

`ConsultaDeCliente` implementa o fluxo (abrir → pesquisar por Phone → 0/1/N → ler campos → conferir telefone → fechar sem salvar; campos ausentes = vazios) sobre a interface `PaginaClientes`, sem ação de escrita.
Falta o adaptador real da página (menu, Phone, Search, resultados, formulário) — precisa das capturas R1/R2. No modo real o programa ainda usa `BuscaSemCadastro`.

## Rótulos do formulário (2026-10-16)

Mapeamento Name/ID number/Date of birth/Phone/Address → nome/cpf/age/phone/location implementado e testado (`camposPorRotulo`). Pronto para o adaptador da página, que ainda precisa da captura `edicao`.

## Evidência da Customer Data List (2026-10-16)

Capturas `clientes`/`resultado`/`edicao`/`rede` recebidas. Registrado em `docs/EVIDENCIAS.md`. Correções:

- **Recon:** não grava mais atributos de dados (`title` com nomes de clientes); passa a capturar controles dentro de tabelas (campos de busca, botões, ícones de ação, rótulo ligado ao campo). Teste cobre o vazamento.
- **Rótulos:** o site usa dois-pontos largo (`Phone：`); a normalização agora o ignora.
- **Bloqueio de escrita** (`update.php`, `delete.php`) criado e testado.
  Falta uma nova rodada de recon (`clientes`, `resultado`, `edicao`) com a ferramenta melhorada para identificar campo `Phone`, botão de busca e o link Edit.

## Adaptador real da Customer Data List (2026-10-16)

`PaginaClientesPlaywright` implementado com a evidência confirmada (menu por texto, busca `ft[phone]` + `#submitButton`, linhas com `checkboxes[]`, link "Edit", leitura por rótulos, volta pelo menu "Voice Call Status") e `instalarBloqueioDeEscrita` (aborta `update.php`/`delete.php` etc.). Ligado ao `main.ts` no lugar de `BuscaSemCadastro`; o monitor pausa durante a consulta. Testado contra site fictício com a mesma estrutura (145 testes). **Ainda não testado no site real** — próximo passo: o usuário rodar `iniciar.bat` e ver a mensagem preparada com os dados do cadastro.

## Stage 4 e Stage 3 Ringing (2026-10-16)

Usuário: **Stage 4 não exige nenhuma ação** (agora ignorado em silêncio, sem aviso nem tarefa). Não se sabe se existe "Stage 3 Ringing"; o rastreador já cobre os dois caminhos (1→3 direto, ou 3 Ringing → 3 Agent: a transferência sai ao chegar em "Stage 3 Agent").

## Fase 5 — Telegram (2026-10-16)

Opção B (GramJS, conta pessoal) — ver DECISOES D9. `ClienteTelegram` (contrato) + `ClienteGramJS` (real, login guiado no console, sessão fora do repo) + `EnviadorTelegram` (`MessageSender`: sucesso→enviada; FLOOD_WAIT curto espera e repete uma vez, longo→falhou; falha definitiva→falhou; timeout/erro→**incerta** e nunca reenvia sozinho; `verify` confere as últimas mensagens do destino). Comandos `telegram.bat login | chats | teste`. `SEND_MODE=live` liberado no modo real, com `TELEGRAM_API_ID/HASH` obrigatórios e confirmação digitada `ENVIAR` a cada inicialização. 154 testes (cliente falso). **[WIN] pendente:** criar api_id/api_hash, `telegram.bat login`, `chats`, `teste`; depois um teste real com `TELEGRAM_DESTINO=me`.

## Fase 6 — Integração e resiliência (2026-10-16)

Feito: login automático com verificação humana (a pessoa clica no botão quadrado; o programa espera, avisa com som e só então preenche `username`/`password` do `.env` **uma vez**; após uma tentativa que falhe, nunca tenta sozinho de novo); depois do login abre "Voice Call Status" pelo menu; **validade da mensagem** (`VALIDADE_MENSAGEM_MIN`, padrão 15: mensagem velha não é enviada, com alerta); **encerramento limpo** (termina a tarefa em andamento e lista pendentes/incertas); testes ponta a ponta com Telegram falso (timeout com/sem entrega, FLOOD_WAIT, 0 resultados, mensagem velha, sessão expirada no meio, encerramento) e soak de 8 h simuladas sem acúmulo de memória. 170 testes.
Não feito (a decidir): recarga ociosa (`RECARGA_OCIOSA_MINUTOS` existe na config mas ainda não age) e vigia de "tabela parada". **[WIN] pendente:** testar login automático real (verificação + preenchimento) e o roteiro observação → `me` → canal definitivo.

## Diário de status (2026-10-16)

`recon` e `start` **não podem rodar juntos** (mesmo perfil de navegador, e o recon mexe na página). Para investigar o que há entre Stage 1 e Stage 3 sem parar o trabalho, o bot grava no arquivo de log (nunca no console) cada mudança de status (`status_mudou`: id curto, de, para, sem telefones).

## Fase 7 — Instalação no Windows (2026-10-16)

`instalar.bat` (confere Node ≥ 22.13, instala, compila e orienta os próximos passos), `iniciar.bat` (primeiro uso abre a configuração; sincroniza dependências), `atualizar.bat`, `telegram.bat`, `configurar.bat`, `simular.bat`, `recon.bat`; teste automático dos `.bat` (CRLF, ASCII, sem parênteses em blocos); README reescrito para o estado real; CI com instalação limpa + build + simulação no `windows-latest`; recomendação de distribuição em DECISOES D10. **[WIN] pendente:** instalar do zero numa pasta limpa seguindo só o README.

## 2º grupo: ligações de 5 min em Stage 1 (2026-10-17)

Regras do usuário: grupo 1 = só transferências; grupo 2 = só ligações que atingiram 5 min **ainda em Stage 1** (se chegou a 5 min já no Stage 3, não vai); mesmo modelo de mensagem; `.env`: `TELEGRAM_DESTINO_5MIN` (vazio = desligado) e `DURACAO_LONGA_MIN` (padrão 5). Implementação: evento `ligacao_longa` no rastreador (uma vez por ocorrência; usa a coluna Call Duration; qualquer status "Stage 1"; ligações já longas na linha de base não contam), tarefa `longa` na fila com enviador próprio, previa distinta no modo observação. 192 testes (rastreador + E2E com dois grupos e falha isolada no 2º).
Suposições a confirmar: (1) "Stage 1" = qualquer complemento (Ringing/Agent/Manual Call); (2) a coluna Call Duration da linha do Stage 1 é confiável.

## Fila de transferências simultâneas (2026-10-17)

A fila já era sequencial (uma consulta por vez na única aba); reforçada: (1) o processamento nunca roda em dois laços ao mesmo tempo e uma tarefa que entra quando o laço está terminando não fica parada; (2) aviso "Tarefa tN entrou na fila (k à frente)"; (3) o tempo em que a leitura da tabela fica parada durante as consultas **não** consome mais a janela de 60 s que liga a linha do Stage 1 à do Stage 3 (antes, uma fila longa podia fazer o bot perder a transferência seguinte). Testes: 3 transferências chegando durante a 1ª saem na ordem; duas transferências simultâneas na tabela; janela cega de 5 min. 197 testes.

## Reaproveitar a mensagem de 5 min na transferência (2026-10-17)

Decisão do usuário: se a ligação já fez 5 min no Stage 1 e a mensagem foi **enviada** ao grupo de 5 min, na transferência o programa envia ao grupo das transferências o **mesmo texto** (sem consultar o cadastro, sem rótulo de "encaminhada"); antes de 5 min, ou se a mensagem de 5 min falhou/expirou/ficou incerta, cria a mensagem normalmente. Escolha de implementação ("o mais garantido"): reenviar o texto guardado em memória pelo mesmo caminho de envio já provado, em vez de usar a API de encaminhamento do Telegram (que falha em grupos com conteúdo protegido). O texto fica só em memória (3 h, `memoriaMensagemLongaMs`), é usado uma vez e some ao reiniciar. Ligação entre as duas mensagens por `vinculo` (callback do Stage 1 + discriminador). 204 testes.

## Mensagem de 5 min editável (2026-10-17)

Pedido do usuário: poder **editar** a mensagem no grupo de 5 min e a versão editada ir ao grupo das transferências, sem rótulo de "encaminhada". Implementação: na transferência o programa **relê a mensagem no grupo de 5 min** (pelo ID guardado do envio, `getMessages`) e envia esse texto atual como mensagem nova ao grupo das transferências. Apagada/ilegível → usa o texto original guardado em memória e avisa. Optou-se por reler+enviar (e não pela API de encaminhar com `drop_author`) porque funciona também em grupos com conteúdo protegido e usa o mesmo caminho de envio já validado. Limite: só reflete edições feitas **até a transferência** (depois disso, a mensagem do grupo de transferências já foi enviada); se o envio de 5 min foi confirmado só pela verificação (sem ID), usa o texto original. 208 testes.

## Registro em .txt (2026-10-17)

`registros/transferencias-concluidas.txt` e `registros/ligacoes-5min.txt` (UTF-8, só acrescenta) recebem o texto de cada mensagem enviada (em observação, marcada como não enviada; mensagens reaproveitadas do grupo de 5 min levam a marca). Gravação desacoplada da fila (`registrar`) e à prova de falha. Config: `REGISTRAR_MENSAGENS` (padrão true), `PASTA_REGISTROS` (padrão `registros`). 213 testes.

## Stage 3 Ringing e CALLBACK (2026-10-17)

Transferência agora sai ao **tocar** (Stage 3 Ringing) ou ao atender direto; o rastreador acompanha por Callee se algum Stage 3 vira Agent. Tocou e sumiu sem atender → evento `callback` após `CALLBACK_ESPERA_SEG` (3 s) sem nenhuma linha de Stage 3 do mesmo Callee (toque que passa a outro agente não conta); na fila vira tarefa `callback` que **responde** "CALLBACK" à mensagem de transferência (reply no Telegram; reserva: texto "CALLBACK + Ph + Line 1 number" sem resposta se a original foi apagada ou o ID é desconhecido), só se a transferência foi enviada. Janela sem leitura (consulta) reinicia o relógio dos 3 s. CALLBACK também vai ao registro `transferencias-concluidas.txt`. 231 testes.
Riscos conhecidos: ligação atendida e encerrada inteira durante uma pausa de consulta (~10 s) pode gerar CALLBACK falso. Linha de Stage 3 com dado faltando (mas Callee e Status legíveis) é ignorada como linha, porém conta como "Stage 3 ainda presente" (`stage3Parciais`) para não gerar CALLBACK falso; linha sem Callee ou sem Status legível não tem como ser reconhecida. 233 testes.

## Rodada de robustez e testes (2026-10-17)

Novos: fuzz do rastreador, caos na fila+Telegram, falhas do site na consulta, resiliência do monitor, mensagens estranhas (252 testes no total). Melhorias: reenvio automático após conferir que a mensagem não chegou; reconferência quando não há rede; monitor à prova de exceção; `unhandledRejection` registrado; reconexão do Telegram antes de operar. Ideias de próximas melhorias em `docs/IDEIAS.md`.

## Notificações do Windows (2026-10-17)

Toast do Windows via PowerShell (sem dependências; texto em base64; reserva por balão da bandeja), acionado pelo `Notificador`: todo alerta `erro` e os `aviso` marcados `{ windows: true }` (login/verificação esperando, monitoramento retomado com janela cega, tabela ilegível, CALLBACK não enviado); informativos (transferência detectada, CALLBACK, ligação de 5 min) só com `NOTIFICAR_TRANSFERENCIAS=true`. Sem repetição em 2 min, máx. 4/min (excedente vira "mais N avisos"), texto mascarado, nunca lança erro, só Windows. Programa parado por erro também notifica. `testar-notificacao.bat` mostra duas notificações de teste. **[WIN] pendente:** confirmar que o Windows as exibe (Assistente de foco/permissões). 264 testes.

## Mensagem duplicada no grupo de 5 min (2026-10-19)

Causa provável (o reenvio automático da rodada de 2026-10-17 + conferência frágil): quando um envio dava timeout, a conferência no grupo comparava o texto exato e exigia horário >= (agora local − 5 s); com o relógio do PC diferente do Telegram, ou o Telegram aparando espaços/linhas em branco das pontas, a mensagem JÁ ENTREGUE parecia "não encontrada" e era reenviada. Corrigido: texto normalizado (CRLF→LF, trim) e tolerância de 15 min no relógio; trava anti-duplicata (mesmo texto não é enviado de novo em 60 s); trava de instância única (`bot.lock`); log `envio_tentativa` por tentativa. Testes: conferência com relógio diferente e com espaços; caos com relógio até 10 min diferente e texto aparado (a mutação de voltar à comparação antiga faz o teste falhar). 273 testes. Não foi possível confirmar a causa exata sem o log do dia (procurar `reenvio_apos_verificacao` e `envio_tentativa`).

## Filtro de funcionários por dígito (2026-10-19)

Pedido do usuário: o Callback Number do Stage 1 termina em `[linha][dono][qualquer]`; o penúltimo dígito diz de quem é o funcionário (0 = equipe do paquistanês, 1 = a do usuário). Todos geram mensagem no grupo de 5 min, mas só os do usuário no grupo de transferências. Implementado em `src/monitor/filtro-funcionario.ts` e aplicado no `Monitor` antes de enfileirar; configurável por `PENULTIMO_DIGITO_TRANSFERENCIA` (padrão `1`) e `PENULTIMO_DIGITO_5MIN` (padrão `*` = todos), com lista (`0,1`) ou `*`. O CALLBACK segue o filtro das transferências (só responde a mensagem que foi enviada). Número com menos de 2 dígitos e filtro ativo: não gera mensagem e avisa. Log `funcionario_filtrado` (telefone mascarado). A linha (antepenúltimo dígito) ainda não é usada; filtrar por ela seria uma variável análoga. 287 testes.

## CALLBACK não respondia à mensagem (2026-10-19)

Causa: em `main.ts` o embrulho do enviador (que imprime "Mensagem enviada") descartava as opções de envio (`responderA`/`reserva`) e a função `reler`; por isso o CALLBACK saía como mensagem solta (ou nem lia a mensagem editada do grupo de 5 min). Corrigido: embrulho movido para `src/telegram/com-aviso.ts`, que repassa tudo, com teste. 288 testes.

## Notificações separadas: transferência e 5 min (2026-10-19)

`NOTIFICAR_TRANSFERENCIAS` (transferência detectada e CALLBACK) e novo `NOTIFICAR_5MIN` (ligação que chegou a 5 min) são independentes, ambos desligados por padrão. Erros continuam notificando com `NOTIFICAR_WINDOWS=true`.

## Números completos nas notificações (2026-10-19)

`NOTIFICAR_NUMEROS_COMPLETOS` (padrão `true`): a notificação do Windows e os avisos da tela mostram o telefone do cliente e o Callback Number por inteiro; com `false` voltam a `***1234`. CPF e e-mail seguem mascarados na notificação. Os arquivos de log continuam sempre mascarados (regra do projeto). Observação: o Windows guarda as notificações no Centro de Notificações.

## Números sempre visíveis + relatório por funcionário (2026-10-19)

1. Removida a chave `NOTIFICAR_NUMEROS_COMPLETOS`: a notificação e os avisos da tela sempre mostram o telefone do cliente e o Callback Number por inteiro (CPF/e-mail seguem mascarados; os arquivos de log sempre mascaram telefone).
2. `relatorio.bat` (menu: hoje, ontem, semana, 7 dias, mês, tudo, datas; ou argumentos `hoje`, `semana`, `de=AAAA-MM-DD ate=AAAA-MM-DD`, `observacao`). Tabela por funcionário (Callback Number do Stage 1): transferências sem callback, callbacks, transferências com callback, ligações de 5 min, mais TOTAL; grava também um .csv (Excel) em `registros/relatorios/`. Sem novo banco/histórico: o relatório é calculado a partir dos .txt de registro, cujo cabeçalho agora inclui `| Funcionário: <número>` (registros antigos: usa a linha "Line 1 number" do texto; callbacks antigos ficam "(não identificado)"). Semântica: a mensagem de transferência sai quando o Stage 3 toca, então "com callback" = todas as transferências, "callbacks" = as que ninguém atendeu, "sem callback" = a diferença. Só entram funcionários que geraram mensagem no grupo de transferências (filtro do penúltimo dígito); no grupo de 5 min entram todos.

## Relatório em página HTML, com callback ligado à ligação certa (2026-10-19)

Problema: o CALLBACK era registrado como texto solto e o relatório contava transferências e callbacks separadamente (sem ligar um ao outro). Agora cada bloco do registro tem `| Funcionário | Cliente | Ligação: <código>` (código = hash curto do `vinculo`, sem telefone) e o relatório liga o CALLBACK à transferência da mesma ligação (cada transferência recebe no máximo um callback). Registros antigos: ligação por proximidade (≤ 30 min, mesmo funcionário quando conhecido, mesmo cliente quando conhecido); sobra = "callback sem a transferência no registro". `relatorio.bat` não imprime mais tabela no terminal: gera `registros/relatorios/relatorio.html` (autônoma, sem internet, claro/escuro, filtros de período dentro da página, lista ligação a ligação, CSV e impressão) e abre no navegador. Teste com navegador real conferindo os números por filtro e que dados nunca viram HTML. Sem LLM: o pareamento é determinístico (mais confiável e sem custo/chave).

## Senha para liberar o envio real (2026-10-19)

A confirmação digitada "ENVIAR" foi substituída por uma senha fixa (não configurável), digitada sem eco (`*`), com 3 tentativas. No código fica só o resumo scrypt (sal aleatório, N=2^17), em `src/seguranca/senha.ts`; a senha não aparece em nenhum arquivo, teste, doc ou commit. Optou-se por hash (irreversível) em vez de criptografia reversível: criptografar exigiria guardar a chave junto ao código. Limite honesto: quem tiver o código pode testar palpites offline (~0,3 s e 128 MB cada); senhas curtas/previsíveis cedem a isso. Para trocar: `npm run gerar-hash-senha` e colar o resultado em `REGISTRO_DA_SENHA`. 309 testes.

## Abrir os menus recolhidos após o login (2026-10-19)

O menu lateral vem recolhido (3 botões "+"). `src/navegador/menu-lateral.ts`: `abrirMenusAte` clica nos "+" (um por vez, reavaliando depois de cada clique, máx. 15, espera por condição) até o item pedido ficar visível; só clica em "+", nunca em itens. Usado antes de clicar em "Voice Call Status" (adaptador de login) e antes de "Customer Data List"/volta (consulta). Se não conseguir, avisa uma vez com a estrutura vista. **Suposição a confirmar:** o "+" é `<img src*="plus">` (padrão dhtmlx); ver PERGUNTAS_ABERTAS. Testado só em site fictício. 316 testes.

## CALLBACK também por ligação curta (2026-10-19)

Novo critério (pedido do usuário): além de "tocou e ninguém atendeu", também é CALLBACK a ligação atendida no Stage 3 que durou MENOS que `CALLBACK_DURACAO_SEG` segundos (padrão 20; 0 desliga). Duração = maior "Call Duration" visto nas linhas de Stage 3/4 daquele Callee (se ilegível, conta desde que o Stage 3 Agent apareceu); a decisão sai `CALLBACK_ESPERA_SEG` segundos depois de a linha sumir da tabela **em qualquer status** (Stage 3 → Stage 4 não encerra a ligação) e nunca durante janela sem leitura. Evento `callback` ganhou `motivo` (`sem_atendimento`|`ligacao_curta`) e `duracaoSeg`; a mensagem é a mesma "CALLBACK" (resposta à transferência); o registro anota `CALLBACK (ligação de N s)`. **Suposição a confirmar:** que o "Call Duration" da linha do Stage 3 mede a duração da ligação do Stage 3 (se incluir o tempo de toque, ligações curtas podem não ser detectadas; se o usuário preferir contar só desde o atendimento, trocar a base). 328 testes.

## Duração média das transferências no relatório (2026-10-19)

Pedido do usuário: o relatório mostra, por funcionário, a duração média das transferências bem-sucedidas (sem callback). O rastreador ganhou o gancho `aoEncerrarLigacao` (ligação atendida cuja linha some da tabela em todos os status, e que NÃO é CALLBACK por ligação curta); o programa grava `código da ligação | duração (s)` em `registros/duracoes.txt` (nova exceção à regra 4, autorizada pelo usuário e registrada no CLAUDE.md). O relatório liga a duração à transferência pelo código; ligações antigas, sem duração, ficam fora da média (a página mostra quantas entraram). Duração = maior "Call Duration" visto da linha do Stage 3/4 (suposição ainda a confirmar: se inclui o tempo de toque). Aparece na tabela por funcionário, no total, num cartão, na lista ligação a ligação e no CSV (em minutos decimais). 335 testes.

## Mensagem de 5 min repetida: análise do log de 2026-10-19 e correção

Log (12,6 mil linhas) + `ligacoes-5min.txt`: (1) o programa foi **reiniciado ~9 vezes** no dia (ids `o`/`t` voltam a 1 logo depois de cada `login_auto`; 3 reinícios vieram logo após `menu_nao_abriu`); a memória some a cada reinício e as ligações que já tinham passado de 5 min eram detectadas de novo (ex.: 13:57:43, três de uma vez, ~3 min depois de já terem sido enviadas) e reenviadas; (2) o mesmo cliente + mesmo funcionário apareceu com códigos de ligação DIFERENTES (outro discriminador Start Time|Callee) segundos depois, e foi tratado como outra ocorrência; (3) os mesmos códigos reapareceram depois do reinício (ex.: 249bca5e92). Correção: `TaskQueue` não gera outra mensagem de 5 min para o MESMO cliente (Callee, só dígitos) dentro de `REPETICAO_5MIN_MIN` (padrão 30 min), e ao iniciar relê `registros/ligacoes-5min.txt` (blocos com `Cliente:` no cabeçalho) para valer também após reinício; se a 1ª não foi enviada (falhou/ignorada), uma nova detecção pode tentar de novo. Transferências e CALLBACK não mudam. Log `longa_repetida`. Em aberto: por que a mesma ligação muda de discriminador/aparece de novo logo após o reinício (a tabela não traz as durações no log) e por que o menu não abriu 3 vezes (nenhum frame com `standartTreeRow`). 343 testes.

## Relatório: alinhamento e ordenação por título (2026-10-19)

Na lista "Ligações do período" o título de cada coluna ficava à direita e o conteúdo à esquerda. Agora título e conteúdo têm o mesmo alinhamento (texto à esquerda, números à direita) e os títulos podem quebrar linha (a tabela por funcionário não precisa mais de rolagem lateral). As duas tabelas ordenam ao clicar no título (botões, funciona com teclado): texto de A a Z no 1º clique (funcionário, cliente, resultado), números do maior para o menor (a data, mais recente primeiro); 2º clique inverte; valores vazios (sem duração) ficam sempre no fim; o TOTAL fica no rodapé; a ordem escolhida se mantém ao trocar o filtro de período. Setas ▲▼ mostram a coluna ativa. Testes com navegador real. 351 testes.

## Relatório: equipe, apelidos, 5 min → transferência e meio-dia (2026-10-19)

(1) Caixa "Mostrar equipe do paquistanês" (penúltimo dígito em `EQUIPE_PAQUISTANES_DIGITOS`, padrão 0) aplicada a cartões, tabelas, lista, gráfico e comparação; coluna Equipe. (2) `APELIDOS_FUNCIONARIOS` (`numero=Nome; ...`): rótulo sempre "Nome (número)" ou "número (sem apelido)", no relatório, no CSV e nos avisos do monitor. (3) Tabela "5 min → transferência": cada ligação de 5 min é ligada à transferência pelo código da ligação (o mesmo `vinculo`); % transferidas/não transferidas por funcionário e total; registros antigos sem código ficam fora das % (a página avisa quantos); repetições do mesmo código não contam de novo. Para incluir a equipe do paquistanês, o programa agora grava `registros/sem-mensagem.txt` (3ª exceção à regra 4, só cabeçalhos) com transferências/CALLBACKs/5 min que o filtro não deixou enviar; durações já eram gravadas para todos. (4) Seção "Antes e depois do meio-dia (Brasília = UTC-3)": comparação de ligações de 5 min, transferências, callbacks, taxa de callback, % 5 min→transferência e duração média, com diferença; gráfico por hora com linha em 12h; quadro por funcionário (antes/depois); todas as tabelas ordenáveis. Meio-dia calculado em UTC-3 mesmo com o PC em outro fuso (os registros .txt guardam a hora local: assume o PC em horário de Brasília). 362 testes.

## Diagnóstico (`diagnostico.bat`, 2026-10-19)

Pedido do usuário (item 4 das sugestões). `npm run diagnostico` / `diagnostico.bat` confere, só lendo/testando: Node ≥ 22.13; fuso do relógio (aviso se não for Brasília, mostrando a diferença); `.env` existe e é válido (mesmos erros em português da inicialização); variáveis do `.env.example` que faltam no `.env`; modelo da mensagem; pastas de dados e de registros graváveis; se há outra cópia aberta (`bot.lock` com processo vivo); navegador escolhido abrindo o `SITE_URL` (sem janela, perfil temporário, sem login); Telegram com a sessão salva e cada destino resolvido (pulado se o bot estiver aberto, para não disputar a sessão); notificações do Windows (`ToastEnabled` no registro do usuário); resumo do log mais recente (aberturas do programa, avisos/erros por código de evento). O programa passou a registrar `programa_iniciado` no log a cada abertura (para o diagnóstico contar reinícios). Código de saída 1 se houver [ERRO]. Lógica em `src/diagnostico/verificacoes.ts` com dependências injetáveis; testes no Linux. 375 testes.

Captcha: o usuário pediu para o bot resolver a verificação sozinho. **Não implementado** (regra 3: não contornar captcha). Continua: a pessoa clica na verificação; o bot preenche usuário/senha uma vez.

## Relatório: marcar uma ligação como callback (2026-10-20)

Pedido do usuário: na lista "Ligações do período", um botão que, depois de uma janela de confirmação, faz o relatório considerar a ligação como callback (só no relatório, sem responder no Telegram). Como a página é um arquivo local e não grava em disco, o `relatorio.bat` agora sobe um servidor local (`src/relatorio/servidor.ts`: só 127.0.0.1, porta aleatória, token aleatório no link e no cabeçalho `X-Token`, confere o `Host`, corpo ≤ 4 KB) que serve a página (relendo os registros a cada abertura) e grava cada marcação em `registros/callbacks-manuais.txt` (4ª exceção à regra 4, registrada no CLAUDE.md; só acrescenta; vale a última linha de cada ligação; "Desfazer" grava `DESMARCADA`). Identificação: código da ligação; registro antigo sem código = hora do registro + funcionário. `montarLigacoes` aplica as marcações (`manual`), a transferência marcada sai da duração média (a duração fica guardada para o Desfazer). Botão só nas ligações atendidas (e "Desfazer" nas marcadas); `<dialog>` com data, funcionário e cliente; erro claro se a janela do `relatorio.bat` foi fechada. O `relatorio.html` aberto como arquivo continua funcionando, sem os botões. Testes de arquivo, cálculo, servidor (token, host, validação) e com navegador real (cancelar, confirmar, recarregar, desfazer, servidor fechado, arquivo sem servidor). 388 testes.

## Relatório: callback removido quando o cliente é transferido de novo e atendido (2026-10-20)

Pedido do usuário (respostas: só no relatório; as duas viram UMA transferência; qualquer funcionário; até 60 min). Em `montarLigacoes` (opção `religacao`): um CALLBACK **do bot** (pareado com a transferência, órfão ou de registro antigo; nunca o marcado à mão) é removido quando existe uma transferência **posterior** do **mesmo cliente** (só dígitos; cliente desconhecido nunca casa), de **qualquer** funcionário, do mesmo tipo (enviada × prévia), com resultado atendida (nem callback do bot nem marcada à mão) e **duração registrada ≥ `CALLBACK_DURACAO_SEG`** (padrão 20; mesma regra do callback por ligação curta: 20 s exatos = atendida normal), até `CALLBACK_RELIGACAO_MIN` (padrão 60; 0 desliga) depois do **registro do CALLBACK**. A 1ª que se encaixa absorve o callback (`substituiu`); a ligação antiga (`callbackRemovido`) sai de todas as contas (cartões, tabelas, meio-dia, gráfico por hora, CSV) e continua na lista, riscada e explicada. Sem duração registrada (ligação em andamento ou antiga) não remove. Se a nova for marcada à mão como callback, o callback antigo volta (o servidor devolve as ligações recalculadas). `relatorio/env.ts` (leitura do .env do relatório, agora testável). 19 testes da regra + teste de mutação (todas as mutações que mudam o resultado são pegas). Pendente [WIN]: confirmar se o "Call Duration" do Stage 3 inclui o toque (afeta os 20 s).

## Transferência de ligação manual (Stage 1 Manual Call → Stage 3) (2026-10-20)

Relato do usuário (aviso "Uma chamada apareceu direto em Stage 3 ... Nenhuma mensagem foi gerada"): o funcionário da linha 1 fez uma ligação MANUAL ao cliente e a transferiu. Log do dia: a linha ficou 14 min em `1|manual call`, o Stage 3 (`3|ringing`) surgiu às 18:16:53 e a linha manual só sumiu 4 s depois — o bot só aceitava `Stage 1 Agent` como origem, então não achou origem e não gerou mensagem (a de 5 min saiu normalmente às 18:07). Correção: `ehOrigemDeTransferencia` (call-tracker.ts) aceita `Stage 1 Agent` **e** `Stage 1 Manual Call` como origem; `Stage 1 Ringing` continua não sendo. Ligação manual sem Stage 3 do mesmo Callee continua sem aviso nem mensagem. Testes (e mutação: sem a correção os 2 novos falham). 410 testes. O outro aviso do dia (17:05:49, `3|ringing` por 7 s e sumiu) não tem origem visível no log (provável chamada que entra direto no Stage 3); fica como está. Pendente [WIN]: confirmar com o usuário que toda ligação manual transferida deve gerar a mensagem de transferência normal.

## Relatório: atualização automática a cada 10 s (2026-10-20)

Pedido do usuário (opção A escolhida: consulta periódica, não SSE/WebSocket nem recarga da página). O servidor do `relatorio.bat` ganhou `GET /dados` (exige `X-Token`; relê os `.txt` a cada pedido e devolve `ligacoes` e `longas` já calculadas, inclusive a regra da religação). A página (`pagina.ts`) pede `/dados` a cada 10 s só se foi aberta pelo servidor, a aba está visível, não está pausada e a janela de confirmação está fechada; só redesenha se os dados mudaram (filtro, ordenação e rolagem preservados; o "hoje" é recalculado a cada desenho). Uma resposta que chega depois de uma marcação concluída é descartada (contador de versão), para não desfazer a marcação na tela. Falha de rede: aviso "Sem conexão com o relatório" e a tabela fica como estava. Botão Pausar/Retomar e "Atualizado às HH:MM:SS". Testes: rota (token, releitura, ausência sem a opção) e navegador real (puxa ligação nova sem recarregar, pausa, diálogo aberto, servidor fechado) com teste de mutação. 416 testes.

## Relatório: duração média = duração até a transferência (2026-10-20)

Pedido do usuário (entre "só depois" e "só até a transferência", escolheu **só até a transferência**): a média deve incluir somente quanto a ligação já durava no momento em que foi transferida para o Stage 3. O `CallTracker` guarda o último "Call Duration" lido enquanto a linha estava num status de origem (`Stage 1 Agent`/`Manual Call`; em `OrigemStage1.duracaoSeg` e `Ocorrencia.duracaoOrigemSeg`, que também cobre a mesma linha mudando de Stage 1 para Stage 3) e entrega em `aoEncerrarLigacao.ateTransferenciaSeg`. `duracoes.txt` ganhou o campo `| Até a transferência: N s` (a `Duração: N s` do Stage 3 continua, porque a regra de callback por ligação curta e a da religação dependem dela). O relatório (`Ligacao.duracaoAteTransfSeg`, `lerDuracoesAteTransferencia`) calcula a média (cartões, tabelas, comparação do meio-dia, CSV) só com esse campo; registros antigos sem ele ficam fora, como já ocorria com ligações sem duração. A lista mostra "Duração até a transferência". **Limite conhecido:** é a última leitura antes de a linha do Stage 1 sumir (até um intervalo de leitura antes da transferência real). Se o "Call Duration" do Stage 3 continuar contando desde o início da ligação, a diferença entre os dois campos mostra o tempo no Stage 3 (pendente [WIN] confirmar). 421 testes (incl. teste de mutação).

## Relatório: planilha Excel no lugar do CSV (2026-10-21)

Pedido do usuário ("CSV muito cru"). O botão virou **Baixar planilha (Excel)** e gera um `.xlsx` no próprio navegador, sem internet e sem biblioteca: `src/relatorio/xlsx.ts` (`montarXlsx`, autocontida; a página recebe o código por `montarXlsx.toString()`) monta um ZIP sem compressão com o mínimo do Office Open XML (textos inline, estilos fixos `ESTILO`, larguras, linha congelada, autofiltro com `_xlnm._FilterDatabase`, mesclagem, paisagem). Abas, todas respeitando período e filtros da tela: Resumo (indicadores + antes/depois do meio-dia), Por funcionário (número e apelido separados, TOTAL), Ligações (data/hora real, cliente como texto, resultado colorido, removidas riscadas, duração até a transferência e no Stage 3, observações), Ligações de 5 min, Meio-dia por funcionário, Por hora (Brasília). Nome do arquivo com as datas do período. Conferido com openpyxl e LibreOffice (abre, formatos de %/duração/data, filtro, congelamento). Testes: estrutura do ZIP (assinaturas e CRC), escape de XML, nome de aba inválido, execução isolada do código, e download real pela página no navegador. O CSV foi removido.

## Fluxo novo: transferência linha 1 → linha 2 (2026-10-21)

Informação do usuário: o fluxo mudou de "linha 1 → Stage 3" para **linha 1 → linha 2 → linha 3**; a linha 2 é o `Stage 2`, com funcionário de antepenúltimo dígito 2 (`***2**`). Respostas às perguntas: na tabela a linha do Stage 1 some e surge outra em `Stage 2 Ringing/Agent` com o número ***2** e o mesmo Callee; vale **status E dígito**; CALLBACK, duração, religação e relatório passam a valer para a linha 2 (mesma mensagem e grupo); a linha 3 (e 1 → 3 direto) é **ignorada** por completo; linha 2 que passa para a linha 3 **nunca** é CALLBACK (nem curta); a MESMA linha mudando de Stage 1 para Stage 2 **conta** como transferência (sem conferir dígito); destino configurável no `.env`.

Implementação: `OpcoesTracker.destinoStage` (padrão 3 no rastreador, para os testes do fluxo antigo; `main.ts` passa o do `.env`, padrão 2) e `destinoDigito` (`digitoDaLinha` = antepenúltimo dígito). Linha nova em Stage 2 com origem mas funcionário de outra linha → aviso novo `destino_fora_da_linha`, sem mensagem. Fluxo novo: transições que envolvem Stage 3 são ignoradas em silêncio; no acompanhamento, linhas do Stage 3 não contam como "ligação ainda na tabela" e marcam `foiAdiante` (sem CALLBACK de nenhum tipo; duração = só a da linha 2). O leitor passou a guardar o Stage das linhas incompletas (`stage3Parciais[].stage`, 2/3/4). `.env`: `TRANSFERENCIA_DESTINO_STAGE` (2–3, padrão 2) e `TRANSFERENCIA_DESTINO_DIGITO` (dígito ou `nenhum`, padrão 2). Avisos e console falam do Stage configurado. Cenário do `npm run simular` atualizado para o fluxo novo. Relatório: textos neutros ("linha 2; até 21/10/2026, o Stage 3"); coluna da planilha "Duração depois da transferência". 19 testes novos (fluxo, linha 3, dígito, mesma linha, CALLBACK/duração, linhas incompletas, config, fluxo antigo) + teste de mutação. 445 testes.

## Notificação do Windows abre o Telegram na mensagem (2026-10-22)

Pedido do usuário: clicar na notificação do Windows e abrir o Telegram direto no grupo da mensagem de transferência. O enviado precisa existir antes do link, e a notificação de detecção sai antes do envio; por isso há uma **notificação nova quando a mensagem é enviada** (`TaskQueue.avisarEnviada`): "Transferência/CALLBACK/Ligação de 5 min enviada ao grupo: cliente…, funcionário…. Clique para abrir no Telegram.", sem som (`semSom`), nas mesmas opções `informativo`/`informativo_5min` (`NOTIFICAR_TRANSFERENCIAS`/`NOTIFICAR_5MIN`). O `ClienteGramJS.enviar` monta o link (`linkDaMensagem`, `cliente.ts`): supergrupo/canal público → `tg://resolve?domain=<usuário>&post=<id>`, privado → `tg://privatepost?channel=<id sem -100>&post=<id>`; grupo comum/conversa privada/Mensagens Salvas não têm link (sem a notificação extra). O link segue `ResultadoEnvio.link` (inclusive na trava anti-duplicata). O toast (`scriptDoToast`) usa `activationType="protocol"` + botão "Abrir no Telegram"; o endereço só entra em base64 e só passa por `linkSeguro` (formato `tg://` estrito; qualquer outro vira toast comum). Não mudei a notificação de detecção (continua saindo antes do envio, sem link). 456 testes + mutações. Pendente [WIN]: conferir com o Telegram Desktop real que o clique abre a mensagem e que o ID do supergrupo sai certo (se a notificação nunca aparecer, o grupo é comum ou `m.chat` veio vazio).

## Registro da causa quando o programa fecha sozinho (2026-10-22)

Relato do usuário: o programa se encerrou sozinho várias vezes em poucos minutos, enquanto ele mexia em outro programa que usa o mesmo `api_id`/`api_hash` do Telegram. Sem o log do dia não dá para afirmar a causa. `main.ts` agora registra no arquivo de log: `excecao_sem_tratamento` (exceção solta, ex.: erro de conexão do GramJS; o programa continua rodando e avisa; 10 seguidas encerram com calma), `sinal_recebido` (SIGTERM/SIGHUP/SIGBREAK: janela fechada, Windows desligando, outro programa matando o processo; encerra normalmente) e `programa_encerrado` (com o código de saída), além do `programa_iniciado` que já existia. Verificado em execução simulada (SIGTERM → os dois eventos no log). Sem teste automatizado (fica em `main.ts`). Pendente: ler o log do usuário (pasta `dados\logs`, arquivo do dia) para saber a causa real.

## Aviso "todas as linhas lidas estão sendo ignoradas": menos alarme falso e com motivo (2026-10-22)

Relato do usuário: `[AVISO] Todas as linhas lidas estão sendo ignoradas há 10 leituras (dados faltando ou layout diferente).` O aviso disparava sempre que a leitura não tinha nenhuma linha utilizável e ao menos uma ignorada, por 10 leituras seguidas. Duas situações **normais** cumprem isso: (a) a tabela sem ligações no momento (o site mostra uma linha-aviso de uma célula, que era ignorada e contada); (b) só há linhas de Stage 2/3/4 com um dado faltando (ex.: ligação longa na linha 3 sem Start Time; no log de 2026-10-22 nenhuma linha de Stage 3 aparece completa). Sem os dados da tela do usuário não dá para afirmar qual dos dois foi. Agora o leitor classifica cada linha ignorada (`tabela_vazia`, `stageN_sem_*`, `sem_start_time`, `sem_callback`, `colunas_a_mais`, `colunas_a_menos`...; só contagens, sem dados de cliente) e conta como "inexplicada" só o que não é a linha-aviso nem um Stage 2/3/4 com Callee e Status legíveis. O monitor só alerta se houver inexplicadas, e o aviso passa a trazer `Motivos: ...` (também vai para o log como `linhas_ignoradas`). Snapshots sem a classificação (testes antigos) continuam alertando como antes. 459 testes + mutações.

## 2026-10-22 — Uma só notificação do Windows por transferência

- Com `SEND_MODE=live`, a notificação de detecção (sem clique) deixa de aparecer para o que será enviado; o som continua. Fica só a "enviada ao grupo", clicável (abre o Telegram na mensagem). Em modo observação nada muda. Se o grupo não tiver link de mensagem (grupo comum), não há notificação do Windows de transferência (só console/som).

## 2026-10-22 — Vigia da página, reabertura automática, fuso de Brasília e sessão do Telegram cifrada

Pedido do usuário (itens 4, 5, 8 e 12 da lista de melhorias).

- **Vigia (`Monitor.vigiarPagina`/`vigiarLeiturasRuins`/`recarregar`)**: recarrega a página do site (`page.reload` + `garantir()`, que refaz menu/login) quando (a) não há ligação nenhuma na tabela por `RECARGA_OCIOSA_MINUTOS` (padrão novo 30; 0 desliga; recarga silenciosa); (b) há ligação com duração correndo mas a tabela inteira está idêntica por `TABELA_PARADA_MINUTOS` (padrão 5; 0 desliga) — tela congelada; (c) ~1 min de leituras falhando/ilegíveis seguidas. Se 4 recargas por problema acontecem com menos de 10 min entre elas, o monitor pede reinício (`aoPrecisarReiniciar`: `process.exitCode = 75` e encerra). Após recarregar, `tracker.marcarJanelaSemLeitura()` preserva as chamadas conhecidas. Pendente [WIN]: ver no site real que o reload volta sozinho à Voice Call Status (se cair no menu, o `garantir` avisa e espera o menu, como na sessão expirada; relacionado a `menu_nao_abriu`).
- **Supervisor (`src/supervisor.ts` + `src/supervisao.ts`, `npm run supervisor`, usado pelo `iniciar.bat`)**: reabre o programa em 5 s se ele fechar sem pedido (código 75, queda por sinal, qualquer código diferente de 0/1/2); 0 (sair/Ctrl+C) e 1/2 (configuração, senha, Telegram sem login) não reabrem; desiste após 6 aberturas em 10 min. Navegador fechado agora também pede reabertura (`navegador_fechou` no log). No envio real o reaberto pede a senha de novo (a senha nunca é guardada). `npm start` continua abrindo sem supervisor.
- **Fuso (`src/util/fuso.ts`, `FUSO_HORARIO`, padrão America/Sao_Paulo)**: `process.env.TZ` é aplicado no `main` e no relatório, então console, notificações, registros .txt e relatório usam Brasília independente do Windows. O arquivo de log passa a ter `time` legível com offset (`2026-10-22T12:45:14.123-03:00`, antes era epoch) e o nome do arquivo usa a data de Brasília. O HTML do relatório mostra os horários e exporta o .xlsx no fuso do programa (antes: o do navegador). Registros antigos são lidos como horário de Brasília (supõe PC que já estava nele).
- **Sessão do Telegram cifrada (`src/seguranca/cofre.ts`)**: `sessao.txt` guarda `TBSESS1:`+base64(sal, iv, etiqueta, AES-256-GCM) com chave scrypt da senha de liberação. `ClienteGramJS.conectar` recebe `senhaDaSessao` (main, `telegram.bat`, `diagnostico.bat` pedem a senha); sessão antiga em texto é migrada ao salvar; gravação via arquivo temporário + rename. Limite honesto: quem tiver o arquivo e o código pode testar palpites da senha offline (cada um custa ~0,1 s e 64 MB), então a proteção vale o quanto a senha for longa/imprevisível.
- Testes: `cofre-sessao`, `fuso-horario`, `vigia-pagina`, `supervisao`, `relatorio-fuso` (+ mutações conferidas).

## 2026-10-22 — atualizar.bat acrescenta ao .env as variáveis novas

Pedido do usuário (item 7). `src/config/atualizar-env.ts` (`acrescentarFaltantes`) compara o `.env` com o `.env.example` e acrescenta ao FIM do `.env`, sob um cabeçalho, só as variáveis ativas que ele não tem (com o bloco de comentários que as precede e o valor padrão); respeita CRLF; nunca altera linha existente; idempotente. `atualizar-env-cli.ts` (`npm run atualizar-env`, chamado pelo `atualizar.bat` depois do `npm install`) grava a cópia `.env.bak` (ignorada pelo git, `.env.*`) antes de escrever. Variável comentada no `.env` conta como ausente (entra o padrão, que é o que o programa já usava). Testes em `atualizar-env.test.ts` + mutação.

## 2026-10-22 — Transferência adicionada à mão no relatório

Pedido do usuário. Botão "Adicionar transferência manual" (só no relatório aberto pelo `relatorio.bat`): nome, CPF (11 números), telefone (8–15), Line 1 number (4–15) e data/hora (vem agora, no fuso do programa). `POST /adicionar` (token + JSON, validação em `transferencias-manuais.ts`: recusa quebra de linha no nome para ninguém forjar outro bloco) acrescenta um bloco em `registros/transferencias-manuais.txt` (cabeçalho `SEM MENSAGEM (adicionada à mão) | Tipo: transferencia | Funcionário: <Line 1> | Cliente: <telefone> | Ligação: manual-<id>`; corpo com Location/Age/Occupation vazios). O arquivo entra em `ARQUIVOS_DO_RELATORIO`: conta como transferência real, sem duração (fora da média), e dá para "Marcar como callback". Quinta exceção de registro em CLAUDE.md. Testes em `transferencia-manual.test.ts` (validação, rota, navegador) + mutações.

## 2026-10-22 — Transferência manual conta nas "5 min que viraram transferência"

Problema relatado: a transferência adicionada à mão não entrava nessa métrica, que liga a ligação de 5 min à transferência pelo código da ligação (a manual tem código `manual-…`, sem relação com nenhuma ligação de 5 min). Agora `montarLigacoes` casa cada transferência manual com a ligação de 5 min mais recente do MESMO telefone (compara o final, com ou sem DDI/DDD; mínimo 8 números) que começou até 2 h antes dela (e no máximo 5 min depois, por folga de digitação), ainda não transferida; cada ligação de 5 min é usada uma vez. Vale também para registros antigos sem código. Texto explicativo da página atualizado. Testes + mutações em `transferencia-manual.test.ts`.

- (2026-10-22) A comparação de telefones do relatório (`soDigitos`) ignora zeros à esquerda: 011963507426 e 11963507426 são o mesmo número, tanto no casamento da transferência manual com a ligação de 5 min quanto na regra da religação.
