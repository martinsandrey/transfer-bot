# Progresso

| Fase                                        | Situação                                      |
| ------------------------------------------- | --------------------------------------------- |
| 1 — Investigação, requisitos e arquitetura  | **Entregue, aguardando aprovação do usuário** |
| 2 — Navegador, login e leitura da tabela    | Não iniciada                                  |
| 3 — Monitoramento e fila (simulação)        | Não iniciada                                  |
| 4 — Customer Data List, cadastro e mensagem | Não iniciada                                  |
| 5 — Telegram                                | Bloqueada (decisão do usuário pendente)       |
| 6 — Integração e E2E                        | Não iniciada                                  |
| 7 — Instalação no Windows                   | Não iniciada                                  |

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
