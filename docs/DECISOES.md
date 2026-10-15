# Registro de decisões

Formato: contexto · alternativas · escolha · consequências. Status: **Decidida** (fechada nesta fase),
**Proposta** (recomendação aguardando confirmação do usuário) ou **Pendente** (decisão do usuário).
Versões verificadas em 2026-10-15 com `npm view` (npm registry acessível na nuvem).

## D1 — Linguagem e runtime — Decidida

- **Contexto:** programa Windows, executado localmente, sem servidor; precisa de Playwright e de código testável no Linux.
- **Alternativas:** Python + Playwright; Node.js + TypeScript + Playwright; executável único (pkg/bun).
- **Escolha:** Node.js + TypeScript (ESM, strict). Alvo no Windows: **Node 24 LTS** (v24.22.0 em 2026-10-14; Node 26.12.0 é a linha
  "Current"). `engines: >=22.13` porque ESLint 10 e Vitest 5 exigem Node ≥22.12/22.13; a nuvem usa 22.22.
- **Consequências:** Node precisa estar instalado no Windows (Fase 7 verifica). Executável único é evitado (complica Playwright).

## D2 — TypeScript 6.0.x, não 7.x — Decidida

- **Contexto:** `typescript@7.0.2` (compilador nativo) é a "latest" no npm; `typescript-eslint@8.71.2` declara peer
  `typescript >=4.8.4 <6.1.0`.
- **Escolha:** `typescript@6.0.3` (fixo). Reavaliar a migração para 7 quando o typescript-eslint a suportar.
- **Consequências:** nenhuma perda funcional; lint com regras tipadas continua possível.

## D3 — Ferramentas de desenvolvimento — Decidida

Versões fixas (lockfile commitado): `vitest 5.0.5` (test runner; TS direto, relógio falso, mocks — alternativa `node:test`
descartada por menos recursos de mock/timers), `eslint 10.12.0` + `typescript-eslint 8.71.2` (preset `strict`),
`prettier 3.9.10`, `@types/node 22.20.5`. CI: GitHub Actions em `ubuntu-latest` e `windows-latest` com Node 24.

## D4 — Playwright e navegador — Proposta (usuário: Windows 11, qualquer navegador, só Defender → padrão msedge)

- **Versão:** `playwright 1.64.1` (publicada em 2026-10-15; depende de `playwright-core` 1.64.1; Node ≥20). Entra na Fase 2.
- **Ambiente da nuvem:** Chromium 141 (revisão 1194) pré-instalado em `/opt/pw-browsers`, diferente da revisão esperada pelo
  Playwright 1.64 (1248, Chromium 156). Na Fase 2 tentar `npx playwright install chromium` (CDN do Playwright responde pela
  proxy) ou usar `executablePath` — nos testes simulados a diferença é irrelevante.
- **Alternativas no Windows:** (a) Chromium baixado pelo Playwright (`npx playwright install chromium`, ~150 MB, versão
  testada junto com a biblioteca; depende de download — antivírus/proxy podem atrapalhar); (b) **Edge instalado** via
  `channel: "msedge"` (já vem no Windows 10/11, sem download; atualiza sozinho, raro risco de incompatibilidade; políticas
  corporativas podem interferir); (c) Chrome instalado (não garantido).
- **Proposta:** suportar os dois por configuração (`NAVEGADOR=msedge|chromium`); **padrão `msedge`** se o usuário confirmar que
  pode usá-lo (menos coisas para instalar), com `chromium` como alternativa. Ambos com `launchPersistentContext`, `userDataDir`
  dedicado fora do repositório, janela visível (`headless: false`), `viewport: null`. Pendente: P-ED1 (Edge permitido?).
- **Consequências:** perfil dedicado nunca toca o navegador pessoal; trocar de navegador implica novo login.

## D5 — Configuração e credenciais — Proposta

- **Configuração:** arquivo `.env` (+ `config/mensagem.txt`), lido com `process.loadEnvFile`/`util.parseEnv` (nativos do Node;
  verificado na nuvem com Node 22 — evita a dependência `dotenv 18.0.8`) e validado com **zod 4.6.7**. Mensagens de erro em
  português. Alternativa: `dotenv` (somente se o parser nativo se mostrar insuficiente no Windows/CRLF — testar na Fase 2).
  Para quem não é técnico: `configurar.bat` (Fase 7) cria o `.env` a partir do exemplo e abre no Bloco de Notas.
- **Senha do site:** (a) `.env` em texto puro; (b) Gerenciador de Credenciais do Windows via `@napi-rs/keyring 2.1.1`
  (binários pré-compilados para win32 x64/arm64/ia32; mantido — publicado 2026-10-10) — a alternativa `keytar 7.9.0` está sem
  publicação desde 2025-07 e é de repositório arquivado (verificar antes de qualquer uso); (c) PowerShell `cmdkey`/DPAPI
  (`ConvertFrom-SecureString`), sem dependência nativa.
- **Avaliação:** o keyring protege contra leitura casual do arquivo (sincronização em nuvem, backups, compartilhamento da
  pasta), mas **não** contra outro processo rodando como o mesmo usuário Windows — o mesmo vale para o `.env`. Como a senha muda
  com frequência e o usuário não é técnico, a complexidade (dependência nativa + fluxo de gravação/rotação) **não compensa agora**.
- **Proposta:** `.env` para tudo, `.env` fora de pastas sincronizadas (OneDrive), nunca commitado, senha nunca em log;
  `LOGIN_AUTOMATICO=false` por padrão (login manual sempre possível). Keyring fica como melhoria opcional futura.

## D6 — Logs — Proposta

`pino 10.4.0` (JSON estruturado; redação de caminhos via `@pinojs/redact`; Node ≥20) com _allow-list_ de campos e serializer de
mascaramento de telefone/CPF; console legível via `pino-pretty 13.2.0` (opcional, só console) e arquivo no diretório de dados.
Rotação: arquivo por dia criado na inicialização (sem dependência) ou `pino-roll 4.0.0` se necessário. Alternativas: `winston`
(mais pesado), logger próprio mínimo (menos dependências, mas reinventa mascaramento/níveis). Decisão final na Fase 2.

## D7 — Som e alertas no Windows — Proposta

Sem dependência: processo filho do **PowerShell** (já presente no Windows 10/11) tocando `[System.Media.SystemSounds]::Exclamation`
ou um `.wav` de `C:\Windows\Media`, com beep de console (`\x07`) como reserva e mensagem em destaque no console.
Alternativas: `node-notifier 11.0.0` (toasts + som; mantido, mas dependências nativas/binários auxiliares e comportamento do
Windows com notificações/Foco), `sound-play 1.1.0` (sem publicação desde 2022-05). Validar no Windows na Fase 2; testes usam
um `Notifier` falso.

## D8 — Persistência — Decidida

Nenhum banco, nenhum JSON de histórico. Estado em memória (ocorrências, tarefas, dedup com TTL). Persistido apenas: perfil do
navegador, sessão do Telegram (quando houver), `.env` e modelo de mensagem. O Telegram é o histórico. Consequência assumida:
reinício = nova linha de base; transferências com o bot fechado não são recuperadas.

## D9 — Levantamento das opções de Telegram — **PARCIAL: conta pessoal exigida (2026-10-15); falta escolher A ou B na Fase 5** (nada instalado ou implementado)

Versões (npm, 2026-10-15): `telegram` (GramJS) 2.26.22 (último publish 2026-07-14); `tdl` 8.1.0 (2026-03-10);
`prebuilt-tdlib` 0.1008067.0 (2026-08-26; binários `@prebuilt-tdlib/win32-x64` etc.); `grammy` 1.46.0 (Bot API).

| Critério                | A. Conta pessoal — TDLib (`tdl` + `prebuilt-tdlib`)                                                                                                              | B. Conta pessoal — GramJS (`telegram`)                                                   | C. Bot API (ex.: `grammy` ou `fetch` direto)                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Aparece como            | **Você** (mensagem do seu usuário)                                                                                                                               | **Você**                                                                                 | **Bot** (nome do bot)                                                                                                       |
| Credenciais             | `api_id` + `api_hash` (my.telegram.org) + login por telefone/código/2FA                                                                                          | idem                                                                                     | token do @BotFather; sem telefone                                                                                           |
| Dependência nativa      | Sim: biblioteca TDLib (C++). Pré-compilada para Windows x64 via `prebuilt-tdlib`; compilar à mão exige MSVC, CMake, vcpkg, OpenSSL, zlib, gperf (longo e frágil) | Não (JS puro; algumas deps como `websocket` podem ter parte opcional nativa — verificar) | Não                                                                                                                         |
| Dificuldade no Windows  | Média (DLL pré-compilada ok; risco de antivírus/versão da TDLib vs. `tdl`)                                                                                       | Baixa                                                                                    | Muito baixa                                                                                                                 |
| Confirmação de entrega  | Sim: `updateMessageSendSucceeded`/`Failed` com id da mensagem                                                                                                    | Sim: resposta da API traz a mensagem enviada (id)                                        | Sim: resposta síncrona `ok` com `message_id`                                                                                |
| Envio incerto (timeout) | Possível; verificável lendo o histórico do chat                                                                                                                  | Possível; verificável lendo o histórico                                                  | Possível; Bot API não lê o histórico do chat → difícil verificar; usar texto com chave de idempotência e checar manualmente |
| FLOOD_WAIT / limites    | Trata-se de erros 420/`FLOOD_WAIT_X`; TDLib espera/relata                                                                                                        | `FloodWaitError` (a lib pode aguardar abaixo de um limite configurável)                  | HTTP 429 com `retry_after`; ~1 msg/s por chat, ~20/min em grupo                                                             |
| Sessão                  | Diretório do banco TDLib (acesso total à conta; **proteger**, fora do repo)                                                                                      | String/arquivo de sessão (idem)                                                          | Só o token (revogável no BotFather)                                                                                         |
| Risco para a conta      | Uso de automação em conta pessoal pode gerar restrição se parecer spam; volume baixo/destino único reduz risco; exige `api_id` próprio                           | Idem                                                                                     | Baixo para a conta pessoal (conta separada)                                                                                 |
| Manutenção              | TDLib oficial (Telegram); `tdl` 8.x ativo                                                                                                                        | Comunidade; versões frequentes mas o ritmo depende do mantenedor                         | API oficial estável                                                                                                         |
| Destino                 | Qualquer chat/grupo/canal em que você já está                                                                                                                    | idem                                                                                     | Chat em que o bot foi adicionado (grupo/canal precisa incluir o bot; bot não inicia conversa privada sozinho)               |

**Tendência (não é decisão):** se a mensagem **precisa** aparecer como sendo sua → B (GramJS: menos atrito no Windows, sem
compilação) ou A (mais robusta, mas com binário nativo). Se pode aparecer como bot → C é de longe o mais simples e seguro.
Perguntas que decidem: P-TG1..P-TG3 em `PERGUNTAS_ABERTAS.md`.

## D10 — Segurança em profundidade — Decidida (detalhes nas fases)

Modo observação padrão; `live` com confirmação a cada inicialização; bloqueio de escrita na aba de consulta via
`context.route` (somente após confirmar como a pesquisa é feita); nunca clicar em salvar/atualizar/excluir; uma tentativa de
login; sem tracing/screenshots por padrão; códigos de verificação só no console.
