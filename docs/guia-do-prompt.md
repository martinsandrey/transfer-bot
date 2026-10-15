# Guia do prompt inicial

Este documento acompanha [`prompt-inicial.md`](./prompt-inicial.md). O prompt é o texto que você cola numa nova sessão do Claude Code; este guia explica a estrutura dele, o que ainda depende de você, os riscos técnicos e como avaliar a Fase 1.

## 1. Por que o prompt está estruturado assim

- **Regras de trabalho primeiro.** Cada sessão na nuvem começa sem memória. As regras invioláveis (uma fase por vez, não inventar nada sobre o site, nada de segredos ou banco de dados, nunca salvar cadastro) ficam no topo para valerem em todas as fases. O prompt também manda o Claude registrá-las no `CLAUDE.md`, que é lido automaticamente nas sessões seguintes.
- **Documentos como memória.** `ARQUITETURA`, `DECISOES`, `PERGUNTAS_ABERTAS` e `PROGRESSO` mantêm o contexto entre sessões, sem depender do histórico da conversa.
- **Sem acesso ao site, desenvolve-se com evidência.** O Claude na nuvem não vê o site. Por isso a Fase 2 começa com uma ferramenta de reconhecimento que você roda no Windows. Ela captura a estrutura da página com os dados pessoais trocados por marcadores. Os seletores saem dessa captura, não de palpites.
- **Arquitetura "a avaliar", não imposta.** O prompt sugere Node/TypeScript/Playwright, mas exige uma comparação registrada (em especial TDLib vs. GramJS). Assim a decisão fica documentada e pode ser revista.
- **Problemas difíceis declarados de antemão.** Identidade de chamada numa tabela que se reordena, linha de base ao iniciar, monitoramento que não pode parar durante a consulta, envio incerto e navegador em segundo plano. Se esses pontos não estiverem escritos no prompt, um agente tende a resolvê-los de forma ingênua.
- **Critérios de conclusão objetivos** em cada fase, e uma pausa obrigatória antes de avançar, para você validar no Windows o que a nuvem não consegue testar.
- **Segurança por padrão.** Modo observação como padrão, envio real com dupla confirmação e bloqueio de requisições de escrita na aba de consulta.

## 2. Informações que você ainda precisa fornecer

| # | Informação | Quando |
|---|---|---|
| 1 | URL do sistema e da página da tabela; se há 2FA/captcha no login; quanto tempo a sessão dura | Fase 1–2 |
| 2 | Captura anonimizada da tabela de chamadas (gerada pela ferramenta `recon`) | Fase 2 |
| 3 | Todos os valores de `Call Status` e a sequência normal de uma chamada (Stage 2 existe? Stage 3 pode voltar para Stage 1?) | Fase 3 |
| 4 | **Papel exato da regra de cinco minutos**: é um pré-requisito para considerar a transferência, um filtro, um alerta? Usa `Call Duration` ou `Start Time`? | Fase 3 |
| 5 | Se há ID único de chamada; formato/fuso de `Start Time`; formato de `Call Duration` e dos telefones | Fase 2 |
| 6 | O que acontece com a linha quando a chamada termina; se a tabela é paginada ou filtrada | Fase 2–3 |
| 7 | Se a Customer Data List pode ser aberta em outra aba sem derrubar a tabela | Fase 4 |
| 8 | Campos lidos na edição do cliente e **quais podem ser compartilhados no grupo** | Fase 4 |
| 9 | **Modelo exato da mensagem** | Fase 4–5 |
| 10 | Grupo de destino, grupo de teste e volume esperado de mensagens por dia | Fase 5 |
| 11 | `api_id`/`api_hash` próprios (criados em my.telegram.org; vão no `.env`, nunca no código) | Fase 5 |
| 12 | Se a mensagem precisa do nome do funcionário (mapeamento Callback Number → nome) | Fase 4–5 |
| 13 | Versão do Windows, se Node já está instalado, se pode usar o Edge, restrições de antivírus/proxy | Fase 1 / 7 |

## 3. Riscos técnicos que o Claude deve investigar antes de fechar a arquitetura

1. **Identidade da chamada.** Sem ID único, uma chave composta pode confundir ligações sucessivas do mesmo funcionário para o mesmo cliente. A posição da linha nunca serve como identidade.
2. **Transições perdidas.** Com atualização a cada segundo, uma chamada pode passar de Stage 1 para Stage 3 entre duas leituras, ou aparecer já em Stage 3. É preciso definir se isso conta como transferência.
3. **Monitoramento interrompido durante a consulta.** Se a pesquisa do cliente acontecer na mesma aba, a tabela fica sem leitura. Uma segunda aba resolve, se o site permitir.
4. **Leitura no meio da atualização.** Uma leitura parcial pode produzir linhas incompletas ou duplicadas. Isso pede leitura atômica e confirmação em leituras consecutivas.
5. **Navegador em segundo plano.** O Chromium reduz timers em janelas minimizadas ou ocultas, o que pode congelar a atualização da tabela.
6. **TDLib no Windows.** Compilar exige Visual Studio, CMake, vcpkg, OpenSSL, zlib e gperf, e o build é longo. Binários pré-compilados (`prebuilt-tdlib`) e o GramJS (JavaScript puro) evitam isso, mas cada opção tem seus próprios riscos de manutenção e de compatibilidade com o Node.
7. **Conta pessoal no Telegram.** Exige `api_id`/`api_hash`, há limites de `FLOOD_WAIT` e risco de restrição da conta se o uso parecer abusivo. O arquivo de sessão dá acesso total à conta e precisa de proteção.
8. **Confirmação de entrega.** É preciso saber se a mensagem foi realmente aceita pelo servidor e o que fazer quando o resultado é incerto, sem reenviar às cegas.
9. **Sessão expirada no site.** Detectar a expiração, pausar, avisar, aguardar o login manual e refazer a linha de base. As transferências ocorridas nesse intervalo podem ser perdidas.
10. **Alteração acidental do cadastro.** Abrir a edição traz o risco de um salvamento involuntário. A mitigação é nunca clicar em Salvar e bloquear requisições de escrita na aba de consulta.
11. **Pesquisa com 0 ou vários resultados**, ou telefone em formato diferente (DDI, máscara). A normalização e a verificação do telefone são obrigatórias.
12. **Seletores instáveis.** IDs gerados automaticamente ou classes CSS de framework podem mudar a cada deploy do site.
13. **Execução longa.** Vazamento de memória da página, recargas, quedas de rede e suspensão do Windows.
14. **Distribuição no Windows.** Node ausente, antivírus bloqueando o navegador ou binários nativos, encoding do console, caminhos com espaços ou acentos.
15. **Privacidade.** Dados de clientes em logs, *traces* do Playwright, capturas de tela ou *fixtures* commitadas por engano.

## 4. Critérios de conclusão da Fase 1

1. Documentos criados e coerentes: `CLAUDE.md`, `docs/ARQUITETURA.md`, `docs/DECISOES.md`, `docs/RISCOS.md`, `docs/PERGUNTAS_ABERTAS.md`, `docs/PLANO_DE_FASES.md`, `docs/RECONHECIMENTO.md`, `docs/PROGRESSO.md`.
2. Comparação das opções de Telegram com recomendação justificada e plano B: build no Windows, dependências nativas, confirmação de entrega, sessão, manutenção e riscos de conta.
3. Arquitetura cobrindo identidade de chamada, linha de base, confirmação de transição, estados da tarefa, estratégia de abas, deduplicação em memória, envio incerto, sessão expirada e modo observação.
4. Nenhum seletor, URL ou comportamento do site inventado; toda suposição marcada como pendente.
5. Esqueleto mínimo: `npm ci`, `lint`, `typecheck` e `test` passando; `.gitignore`, `.gitattributes` e `.env.example` corretos.
6. Nenhum segredo ou dado pessoal no repositório.
7. Perguntas bloqueantes feitas a você e roteiro de reconhecimento pronto para executar no Windows.
8. Commit e push feitos, relatório entregue, e o Claude parou à espera da sua aprovação, sem iniciar a Fase 2.

## Como usar

1. Abra uma nova sessão do Claude Code neste repositório.
2. Cole todo o conteúdo de `docs/prompt-inicial.md` a partir da linha "Você vai atuar como…".
3. Responda às perguntas que ele fizer e revise os documentos da Fase 1 antes de autorizar a Fase 2.
4. Nas sessões seguintes, basta pedir: "Leia `CLAUDE.md` e `docs/PROGRESSO.md` e execute a Fase N".
