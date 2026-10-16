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
