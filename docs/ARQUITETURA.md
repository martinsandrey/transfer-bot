# Arquitetura (proposta da Fase 1)

> Tudo aqui é **proposta**. Nada sobre o site (seletores, colunas além das informadas, formatos, status além dos três Stages)
> foi confirmado; o que depende de evidência está marcado `TODO(confirmar)` e listado em `PERGUNTAS_ABERTAS.md`.

## 1. Visão geral e fluxo de dados

```
            ┌──────────────── processo Node.js (Windows) ────────────────┐
 .env ───►  │ Config ─► Logger(mascara PII)        Notifier (som/console) │
 mensagem   │                                                             │
 .txt ───►  │ Browser ──► aba MONITOR ──► TableReader ──► CallTracker     │
            │    │           (lê a cada ~1 s)           (ocorrências,     │
            │    │                                       transições)      │
            │    │                                           │ Transferência confirmada
            │    └──► aba CONSULTA ◄── CustomerLookup ◄── TaskQueue ◄─────┘
            │            (Customer Data List,    │  (sequencial, em memória)
            │             somente leitura)       ▼
            │                              MessageBuilder ──► MessageSender
            │                                                 (console | Telegram)
            └─────────────────────────────────────────────────────────────┘
```

Fluxo: `TableReader` produz um **snapshot** tipado a cada leitura → `CallTracker` compara com o estado em memória e emite
eventos (`transferencia`, `aviso`, `anomalia`) → `TaskQueue` cria/executa tarefas uma de cada vez → `CustomerLookup`
(aba de consulta) devolve os campos do cadastro → `MessageBuilder` preenche `config/mensagem.txt` → `MessageSender`
entrega (ou, em modo observação, só mostra a prévia no console). **Não há banco, nem arquivo de histórico**: o estado é
um conjunto de objetos em memória; o Telegram é o histórico.

## 2. Componentes e interfaces propostas

Interfaces em TypeScript (rascunho; refinadas nas fases indicadas). Tipos de domínio não carregam seletores do site.

```ts
// ---------- Config (Fase 2) ----------
interface AppConfig {
  site: { url: string; usuario?: string; senha?: string; loginAutomatico: boolean };
  modo: "observacao" | "live";
  monitor: { intervaloMs: number; leiturasConfirmacao: number; ausenciaMaxLeituras: number; ttlOcorrenciasMin: number };
  timeouts: { navegacaoMs: number; consultaMs: number };
  recargaOciosaMin: number; // 0 = desligado
  navegador: "chromium" | "msedge";
  pastas: { dados: string; logs: string }; // fora do repositório
  arquivoMensagem: string;
}

// ---------- Browser (Fase 2) ----------
interface BrowserHost {
  start(): Promise<void>; // launchPersistentContext, janela visível, perfil dedicado
  monitorPage(): Page; // aba que mostra a tabela de chamadas; nunca navega para outro lugar
  openQueryPage(): Promise<Page>; // 2ª aba no mesmo contexto (Fase 4)
  stop(): Promise<void>; // encerramento limpo
}

// ---------- LoginManager (Fase 2) ----------
type EstadoSessao = "logado" | "nao_logado" | "captcha_ou_verificacao" | "desconhecido";
interface LoginManager {
  detectar(page: Page): Promise<EstadoSessao>;
  garantirLogin(page: Page): Promise<"ok" | "manual_necessario">; // 1 tentativa automática, depois pausa
  aguardarLoginManual(page: Page, sinal: AbortSignal): Promise<void>; // alerta sonoro periódico
}

// ---------- TableReader (Fase 2) ----------
interface CallRow {
  callbackNumber: string; // telefone normalizado (só dígitos)
  calleeNumber: string; // idem
  callStatus: string; // texto cru; interpretado por parseStage()
  startTime: Date | null; // TODO(confirmar) formato e fuso
  callDurationSec: number | null; // TODO(confirmar) formato
  extras?: Record<string, string>; // outros campos se a evidência exigir; nunca logados
}
interface TableSnapshot {
  readAt: number; // relógio monotônico (ms)
  rows: CallRow[];
  valid: boolean; // false = leitura parcial/inconsistente (descartada)
  invalidReason?: string;
}
interface TableReader {
  read(): Promise<TableSnapshot>; // leitura atômica (um único page.evaluate ou captura de rede)
}

// ---------- CallTracker (Fase 3) ----------
type Stage = "stage1" | "stage2" | "stage3" | "desconhecido";
type EventoTracker =
  | { tipo: "transferencia"; ocorrencia: OcorrenciaId; callback: string; callee: string }
  | { tipo: "aviso"; codigo: "visto_primeira_vez_stage3" | "sequencia_inesperada" | "status_desconhecido" | "janela_sem_monitoramento"; ocorrencia?: OcorrenciaId }
  | { tipo: "anomalia"; codigo: "callback_duplicado"; callbackMascarado: string };
interface CallTracker {
  /** Primeira chamada após (re)início: define a linha de base; nunca gera tarefa. */
  establishBaseline(s: TableSnapshot): void;
  ingest(s: TableSnapshot): EventoTracker[]; // função pura sobre o estado em memória
  gap(motivo: string): void; // sessão expirada, consulta bloqueante etc. → ver §7
  sweep(now: number): void; // limpeza de ocorrências antigas
}

// ---------- TaskQueue (Fase 3) ----------
interface TransferTask {
  id: string; // = id da ocorrência (chave de idempotência)
  estado: EstadoTarefa; // §5
  callback: string; callee: string;
  tentativas: number;
  cadastro?: CustomerRecord; // só em memória, nunca logado
  mensagem?: string;
}
interface TaskQueue {
  enqueue(ev: Extract<EventoTracker, { tipo: "transferencia" }>): TransferTask | null; // null = duplicada
  runNext(): Promise<void>; // nunca mais de uma tarefa "em execução"
}

// ---------- CustomerLookup (Fase 4) ----------
interface CustomerRecord { nome: string; cpf: string; location: string; age: string; phone: string } // valores literais, só trim
type ResultadoBusca =
  | { tipo: "ok"; registro: CustomerRecord; multiplos: boolean }
  | { tipo: "nenhum" }
  | { tipo: "telefone_divergente" };
interface CustomerLookup { find(calleeNumber: string): Promise<ResultadoBusca> }

// ---------- MessageBuilder (Fase 4) ----------
interface MessageBuilder { build(r: CustomerRecord, callbackNumber: string): string } // modelo carregado e validado na inicialização

// ---------- MessageSender (interface desde a Fase 1; implementação real na Fase 5) ----------
type ResultadoEnvio =
  | { tipo: "enviada"; confirmacao: string }
  | { tipo: "incerta"; motivo: string } // nunca reenviar automaticamente
  | { tipo: "falhou"; motivo: string; reenviavel: true };
interface MessageSender {
  send(texto: string, chaveIdempotencia: string): Promise<ResultadoEnvio>;
  verify?(chaveIdempotencia: string): Promise<"entregue" | "nao_encontrada" | "indeterminado">;
}
// Implementações: ConsoleSender (observação/simulação) e FakeSender (testes). Telegram: pendente de decisão.

// ---------- Notifier / Logger ----------
interface Notifier { alerta(nivel: "info" | "aviso" | "erro", mensagem: string): void } // som no Windows + console
interface Logger { info/warn/error(campos: LogCampos, msg: string): void } // LogCampos é uma lista permitida (allow-list)
```

Responsabilidades resumidas:

| Componente     | Faz                                                                                                       | Não faz                                    |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Config         | Lê `.env`, valida (zod), mensagens em português; falha cedo                                               | Não guarda segredos em código              |
| Logger         | JSON estruturado (pino) em arquivo + console legível; mascara telefone/CPF; allow-list de campos          | Nunca recebe objeto de cliente/linha       |
| Browser        | Contexto persistente, janela visível, flags anti-throttling, abas, bloqueio de escrita na aba de consulta | Não decide regra de negócio                |
| LoginManager   | Detecta estado, 1 tentativa automática, fallback manual, sessão expirada                                  | Não contorna captcha/2FA; sem 2ª tentativa |
| TableReader    | Leitura atômica → `TableSnapshot` normalizado                                                             | Não interpreta transições                  |
| CallTracker    | Ocorrências, linha de base, confirmação, transições, anomalias                                            | Não acessa o navegador                     |
| TaskQueue      | Estados, dedup, sequência, travas, retries                                                                | Não conhece o site                         |
| CustomerLookup | Navega pelo menu, pesquisa, lê o cadastro, fecha sem salvar                                               | Nunca clica em salvar; só lê               |
| MessageBuilder | Preenche o modelo, valida placeholders                                                                    | Não formata/valida conteúdo dos campos     |
| MessageSender  | Entrega e relata resultado                                                                                | Não reenvia sozinho em caso incerto        |
| Notifier       | Som + console                                                                                             | —                                          |

## 3. Identidade da chamada, ocorrências e anomalias

**Regras dadas pelo usuário:** cada funcionário faz uma ligação por vez; o mesmo Callback Number nunca aparece em duas
linhas ao mesmo tempo, mas se repete várias vezes ao dia. Logo:

- **Chave de localização** = Callback Number normalizado (só dígitos). Serve para achar "a chamada atual do funcionário X"
  em qualquer posição da tabela. A posição da linha **nunca** é usada.
- **Ocorrência** = `(callbackNumber, discriminador)`. O discriminador distingue ligações sucessivas.
  `TODO(confirmar)`: candidatos são `Start Time` e/ou `Callee Number` (ou um ID oculto). O código recebe a estratégia por
  uma função injetável `chaveDeOcorrencia(row)`; a Fase 3 só a fixa depois da evidência da Fase 2. Até lá, testes usam um
  discriminador fictício. **Cuidado a validar:** se `Start Time` tiver resolução de segundos e o relógio da tabela variar,
  ou se `Callee Number` repetir em duas ligações seguidas do mesmo funcionário para o mesmo cliente, a escolha muda.
- **Nova ocorrência** quando, para o mesmo Callback Number: (a) o discriminador muda; ou (b) a linha some por mais de
  `ausenciaMaxLeituras` leituras válidas consecutivas e reaparece. Ausências curtas (leitura parcial) **não** encerram a
  ocorrência.
- **Deduplicação** por `id da ocorrência`, nunca só por Callback Number: uma segunda transferência do mesmo funcionário no
  dia tem outro discriminador → outra ocorrência → outra tarefa. O conjunto de ocorrências já processadas fica em memória
  com TTL (`ttlOcorrenciasMin`) e limpeza periódica (`sweep`).
- **Anomalia — mesmo Callback Number em duas linhas no mesmo snapshot:** registra no log (callback mascarado, sem dados
  pessoais), emite `anomalia`, avisa com som, **ignora ambas as linhas** nesse snapshot (não cria nem avança ocorrências
  por elas; ocorrências já existentes desse callback são mantidas congeladas, sem contar como ausentes).
- **Status desconhecido** (qualquer texto que não seja Stage 1/2/3 conhecidos): `Stage` = `desconhecido`; aviso no log,
  nenhuma tarefa; a ocorrência segue sendo rastreada. `TODO(confirmar)`: lista de todos os `Call Status` possíveis.

### Máquina de estados da chamada (por ocorrência)

Estados confirmados: `stage1`, `stage2`, `stage3`, `desconhecido`; mais marcas `baseline`, `ausente`, `encerrada`.

| De (confirmado)                | Para (confirmado)             | Ação                                                                                                        |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| _(nova, após a linha de base)_ | `stage1`                      | rastreia normalmente                                                                                        |
| _(nova)_                       | `stage2`                      | rastreia; sem tarefa                                                                                        |
| _(nova)_                       | `stage3`                      | **sem tarefa**; aviso `visto_primeira_vez_stage3` (a transição pode ter ocorrido entre duas leituras)       |
| `stage1`                       | `stage2`                      | nada (não é do interesse)                                                                                   |
| `stage1`                       | `stage3`                      | **transferência**: evento `transferencia` → tarefa (uma vez por ocorrência)                                 |
| `stage2`                       | `stage3`                      | **inesperado**: sem tarefa; aviso `sequencia_inesperada`                                                    |
| `stage3`                       | `stage1`/`stage2`             | inesperado (`TODO(confirmar)` se Stage 3 pode voltar para Stage 1); sem tarefa; aviso                       |
| qualquer                       | `desconhecido`                | aviso `status_desconhecido`; sem tarefa                                                                     |
| qualquer                       | _(some > N leituras válidas)_ | `ausente` → `encerrada` (descartada; "chamada que some antes de ser processada" não afeta tarefa já criada) |

**Confirmação de transição:** o novo status só vira o status confirmado depois de `leiturasConfirmacao` (N, configurável,
padrão proposto 2) snapshots **válidos** consecutivos mostrando o mesmo valor novo. Oscilação (`1,3,1,3`) zera o contador do
candidato. Isso também protege contra leitura parcial/ruidosa durante a atualização da tabela. Custo: N−1 intervalos de
atraso na detecção (1 s por leitura adicional).

**Linha de base:** o primeiro snapshot válido após iniciar (ou após uma janela sem monitoramento — §7) marca todas as
linhas presentes como `baseline`, inclusive as já em Stage 3: nunca geram tarefa. Só transições observadas depois disso
valem. Reinício do bot = nova linha de base (a memória não persiste, por regra do projeto). Uma ocorrência que estava em Stage 1 na
linha de base e passa a Stage 3 depois **é** uma transição observada durante a execução e gera tarefa; uma que já estava em
Stage 3 na linha de base é ignorada. Consequência assumida: transferências ocorridas com o bot fechado não são recuperadas.

**Snapshot válido** (`TableSnapshot.valid`): cabeçalhos esperados presentes; todas as células obrigatórias legíveis;
contagem de linhas coerente (ex.: não cair a 0 de repente sem sinal de "carregando" — `TODO(confirmar)` como o site mostra
tabela vazia/atualizando). Snapshots inválidos são descartados e **não** contam como leitura nem como ausência.

## 4. Fila de tarefas e processamento sequencial

- Uma tarefa por `transferencia` confirmada; id = id da ocorrência (idempotente: `enqueue` repetido devolve `null`).
- Execução **sequencial** (trava única `executando`); cliques repetidos e tarefas concorrentes são impedidos pela trava e
  pelo estado da tarefa. Retries limitados com backoff (padrão proposto: 2 tentativas na consulta, sem retry automático
  de envio incerto).
- A consulta roda na **aba de consulta**; a aba do monitor continua lendo (ver §6).

### Máquina de estados da tarefa

```
detectada ─► na_fila ─► pesquisando ─► pronta ─► enviando ─► enviada
                │            │            │          ├──────► incerta   (decisão manual; sem reenvio automático)
                │            │            │          └──────► falhou
                │            ├──────────► falhou     (esgotou retries / elemento ausente / timeout)
                │            └──────────► ignorada   (0 resultados; telefone divergente — com alerta)
                └──────────► ignorada     (duplicada / descartada)
 pronta ─► observada   (modo observação: prévia no console, sem envio; terminal)
```

| Estado                                            | Significado                                        | Saídas                                                          |
| ------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| detectada                                         | `CallTracker` confirmou Stage 1→3                  | `na_fila`, `ignorada` (dup.)                                    |
| na_fila                                           | aguardando a trava de consulta                     | `pesquisando`                                                   |
| pesquisando                                       | consulta ao cliente em andamento (aba de consulta) | `pronta`, `ignorada` (0 resultados / tel. divergente), `falhou` |
| pronta                                            | mensagem montada                                   | `enviando` (live), `observada` (observação)                     |
| enviando                                          | `MessageSender.send` em curso                      | `enviada`, `incerta`, `falhou`                                  |
| enviada / observada / ignorada / falhou / incerta | terminais                                          | `incerta` e `falhou` geram alerta sonoro                        |

Resultado de busca: **0** resultados → `ignorada` + erro no log (sem PII) + alerta; **>1** → alerta sonoro e segue com o
primeiro; **telefone do cadastro ≠ Callee Number** (após normalizar dígitos) → `ignorada`, alerta, log sem PII (cliente
errado: nunca enviar).

**Envio incerto** (timeout, queda após o envio): estado `incerta`; **não reenviar automaticamente**; se o `MessageSender`
oferecer `verify` (ex.: procurar a chave de idempotência no chat de destino), tenta verificar; se continuar incerto, alerta
sonoro e pede decisão manual no console (reenviar / dar como enviada / descartar). Não se promete eliminar duplicatas.

## 5. Estratégia de abas

- **Aba MONITOR**: fica na página da tabela; só lê (DOM atômico ou respostas de rede que a própria página já recebe —
  passivo, `TODO(confirmar)` com evidência da Fase 2). Nunca navega.
- **Aba CONSULTA**: segunda aba **no mesmo contexto** (compartilha cookies/sessão), navega pelo menu até Customer Data List
  (sem URLs internas fixas; a URL base vem da configuração), pesquisa, abre edição somente para ler, fecha sem salvar.
  Bloqueio por `context.route`: requisições de escrita (POST/PUT/PATCH/DELETE) que não sejam a própria pesquisa são abortadas
  — **só depois** de confirmar como a pesquisa é feita (Fase 4).
- **Incertezas (precisam de evidência):** o site pode (a) invalidar a sessão ao abrir outra aba, (b) parar de atualizar a
  tabela quando outra aba do mesmo usuário fica ativa, (c) limitar atualizações em aba sem foco. Todas ficam em
  `PERGUNTAS_ABERTAS.md`.
- **Fallback se o site não permitir 2 abas** (aba única): durante a consulta a tabela não é lida (≈ duração da consulta).
  Impacto: transições que **começam e terminam** dentro da janela cega são perdidas (aparecem depois como "primeira vez em
  Stage 3": só aviso). Mitigações: (1) o `CallTracker` **preserva** as ocorrências durante a janela (`gap()` congela as
  ausências, não as encerra), então chamadas já em Stage 1 que passam a Stage 3 nesse intervalo **ainda são detectadas**
  na volta; (2) consultas curtas e com timeout; (3) aviso/log "janela sem monitoramento" com duração; (4) priorizar
  consulta rápida (esperas por condição, não sleep).
- **Segundo contexto/janela separado** (outra janela, mesmo perfil não é possível simultaneamente): descartado — um perfil
  persistente só abre em um processo; duas abas no mesmo contexto é o caminho.

## 6. Login automático com fallback manual

1. Abre `SITE_URL`. `LoginManager.detectar()` classifica a página (`TODO(confirmar)`: sinais — formulário de login, redirect,
   401/403, captcha/2FA — só com evidência).
2. `nao_logado` + usuário/senha configurados + `LOGIN_AUTOMATICO=true` → preenche o formulário e envia **uma única vez**
   (como uma pessoa faria). Aguarda por condição (página da tabela visível) com timeout.
3. Captcha, 2FA, verificação, login falho, credenciais ausentes → **não insiste**: pausa o monitor, som periódico, mensagem
   no console, aguarda login manual (detecção por condição). Códigos de verificação do site são digitados pelo usuário no
   navegador; nada é gravado.
4. **Sessão expirada em operação** (redirect para login, formulário de login visível, 401/403 nas respostas): pausa monitor
   e tarefas, `tracker.gap("sessao_expirada")`, tenta o login configurado **uma vez**; falhou → alerta + espera manual.
   Ao retomar: refaz a linha de base e registra "janela sem monitoramento de X a Y".
5. Trocar a URL no `.env` e reiniciar funciona sem outra mudança (perfil pode pedir novo login — aceitável).

## 7. Modo observação e envio real

- `SEND_MODE=observacao` (**padrão**): detecta, consulta, monta a mensagem e mostra a **prévia no console** (os logs em
  arquivo continuam mascarados e sem PII). Estado final da tarefa: `observada`. Usa `ConsoleSender`.
- `SEND_MODE=live`: exige, a cada inicialização, confirmação digitada no console (ex.: digitar `ENVIAR`); sem confirmação o
  programa volta ao modo observação ou encerra. O destino de teste vs. definitivo é decidido na Fase 5/6.
- Nenhum modo escreve histórico em disco.

## 8. Confiabilidade e execução longa

- Intervalo de leitura configurável; esperas por condição; timeouts configuráveis; backoff limitado; sem loops infinitos de
  cliques/login.
- **Navegador em segundo plano**: janela própria, visível, não minimizada; flags a validar no Windows (Fase 2):
  `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`,
  `--disable-features=CalculateNativeWinOcclusion`; evitar suspensão do Windows (plano de energia / `SetThreadExecutionState`
  via PowerShell filho). A leitura continua em Node via `page.evaluate`, mas se a página não atualiza a tabela em segundo
  plano, o dado é velho — por isso a validação com a janela coberta/minimizada é um teste do roteiro Windows.
- **Execução de dias**: sem acúmulo (sweep de ocorrências/dedup); métricas leves de memória no log; recarga periódica da
  página quando ociosa (nenhuma tarefa ativa, nenhuma Stage 1/2 em curso, `RECARGA_OCIOSA_MINUTOS`), seguida de nova
  linha de base com registro de janela; `SIGINT`/Ctrl+C → encerra tarefas, fecha o contexto, sai limpo.
- **Recuperação**: aba travada/navegação falha/elemento ausente → retry limitado com backoff; esgotado → `falhou` + alerta;
  fechamento inesperado do navegador → alerta e reinício controlado (limite de reinícios).
- **Leitura via rede** (XHR/fetch/WebSocket que a página já recebe, passivo) em vez do DOM: avaliar na Fase 2 com a
  evidência do `recon`; só adotar se mais estável. Nunca chamar endpoints por conta própria.

## 9. Logs, privacidade e configuração

- **Logs**: pino, JSON em arquivo (pasta de dados, fora do repo) + console legível. Campos permitidos por allow-list
  (`evento`, `estadoTarefa`, `idCurto`, `callbackMascarado`, contadores, durações). Proibido registrar `CallRow`,
  `CustomerRecord`, nome, CPF, localização, idade. Telefones sempre `***1234`; um _serializer_ final aplica regex de
  telefone/CPF em strings como rede de segurança. Traces/screenshots do Playwright desligados por padrão (podem conter PII).
- **Config**: `.env` (lido na inicialização com `process.loadEnvFile`/`util.parseEnv`, sem dependência extra) validado
  com zod; mensagens em português apontando a variável e o valor esperado; mensagem de erro **nunca** ecoa a senha.
  `config/mensagem.txt` carregado e validado: placeholders conhecidos = `nome, cpf, location, age, Phone, callback number`;
  desconhecido ou ausente → erro claro. Rótulos fixos `Occupation: ` e `NOTE:` ficam em branco (texto fixo).
  Substituição literal, só `trim()` nas extremidades dos valores.
- Diretórios de sessão (perfil do navegador, sessão do Telegram) em `%LOCALAPPDATA%\TransferBot\` (padrão proposto), fora do
  repositório.

## 10. Estratégia de testes

| Camada                                                                     | Como                                                                                                                                                                                                                             | Fase  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Lógica pura (CallTracker, TaskQueue, MessageBuilder, normalização, config) | vitest, relógio falso, cenários fictícios                                                                                                                                                                                        | 2–4   |
| Leitura/Login/Consulta                                                     | Playwright contra **página simulada local** (servidor HTTP em `127.0.0.1`) que imita a estrutura **confirmada**: atualização a cada 1 s, reordenação, linhas somem/aparecem, leitura no meio da atualização, expiração de sessão | 2, 4  |
| Cenários do tracker                                                        | Todos os listados no prompt (mesma chamada mudando de posição, 1→2, 1→3, 2→3, primeira vez em 3, oscilação, transição entre leituras, duas transferências no dia, callback duplicado, reinício, some antes de processar)         | 3     |
| Ponta a ponta                                                              | site simulado + `FakeSender`; falhas injetadas (timeout de envio, sessão expirada, 0/N resultados)                                                                                                                               | 6     |
| Windows                                                                    | CI em `windows-latest` (lint/typecheck/testes) + roteiro manual do usuário                                                                                                                                                       | 1+, 7 |

Regras: fixtures **sintéticas** (números fictícios, ex.: reservados para ficção); nenhuma captura real é commitada sem
anonimização revisada pelo usuário; testes não podem depender do site real.

## Anexo — como ficou a implementação (2026-10-15)

Diferenças em relação às interfaces propostas acima: `CallTracker.gap()` foi dividido em `marcarJanelaSemLeitura()` (preserva ocorrências: consulta em aba única)
e `reiniciarBaseline()` (sessão expirada). Ids de ocorrência/tarefa (`o3`, `t1`) e `chave` (resumo SHA-256 truncado) **não contêm telefone**. A tarefa `incerta`
mantém a mensagem em memória até a decisão manual; os demais estados terminais apagam cadastro e mensagem. Módulos: `src/monitor` (tracker, monitor), `src/fila`,
`src/mensagem`, `src/leitura`, `src/login`, `src/navegador`, `src/recon`, `src/simulacao`, `src/main.ts`.
