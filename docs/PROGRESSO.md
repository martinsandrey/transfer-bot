# Progresso

| Fase                                        | Situação                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| 1 — Investigação, requisitos e arquitetura  | **Aprovada**                                                                    |
| 2 — Navegador, login e leitura da tabela    | **Em andamento — parada intermediária (aguardando a saída do `npm run recon`)** |
| 3 — Monitoramento e fila (simulação)        | Não iniciada                                                                    |
| 4 — Customer Data List, cadastro e mensagem | Não iniciada                                                                    |
| 5 — Telegram                                | Bloqueada (decisão do usuário pendente)                                         |
| 6 — Integração e E2E                        | Não iniciada                                                                    |
| 7 — Instalação no Windows                   | Não iniciada                                                                    |

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
