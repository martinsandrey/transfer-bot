# Guia do prompt inicial

Este documento acompanha [`prompt-inicial.md`](./prompt-inicial.md). O prompt é o texto que você cola numa nova sessão do Claude Code; este guia explica a estrutura dele, o que ainda depende de você, os riscos técnicos e como avaliar a Fase 1.

## 1. Por que o prompt está estruturado assim

- **Regras de trabalho primeiro.** Cada sessão na nuvem começa sem memória. As regras invioláveis (uma fase por vez, não inventar nada sobre o site, nada de segredos ou banco de dados, nunca salvar cadastro) ficam no topo para valerem em todas as fases. O prompt também manda o Claude registrá-las no `CLAUDE.md`, que é lido automaticamente nas sessões seguintes.
- **Documentos como memória.** `ARQUITETURA`, `DECISOES`, `PERGUNTAS_ABERTAS` e `PROGRESSO` mantêm o contexto entre sessões, sem depender do histórico da conversa.
- **Sem acesso ao site, desenvolve-se com evidência.** O Claude na nuvem não vê o site. Por isso a Fase 2 começa com uma ferramenta de reconhecimento que você roda no Windows. Ela captura a estrutura da página com os dados pessoais trocados por marcadores. Os seletores saem dessa captura, não de palpites.
- **Arquitetura "a avaliar", não imposta.** O prompt sugere Node/TypeScript/Playwright, mas exige que as escolhas fiquem registradas. O Telegram fica atrás de uma interface até você decidir entre conta pessoal e bot.
- **Problemas difíceis declarados de antemão.** Identidade de chamada numa tabela que se reordena, linha de base ao iniciar, monitoramento que não pode parar durante a consulta, envio incerto e navegador em segundo plano. Se esses pontos não estiverem escritos no prompt, um agente tende a resolvê-los de forma ingênua.
- **Critérios de conclusão objetivos** em cada fase, e uma pausa obrigatória antes de avançar, para você validar no Windows o que a nuvem não consegue testar.
- **Segurança por padrão.** Modo observação como padrão, envio real com dupla confirmação e bloqueio de requisições de escrita na aba de consulta.

## 2. Informações que você ainda precisa fornecer

Já respondido:
- Regra de cinco minutos: descartada.
- Stage 2 existe, mas transferências para ele são ignoradas; só `Stage 1 Agent → Stage 3 Agent` gera tarefa.
- Identidade da chamada: `Callback Number`. Nunca aparece duas vezes ao mesmo tempo, mas se repete ao longo do dia. A deduplicação é por ocorrência de chamada.
- Stage 1 vai ou para Stage 2 (ignorar) ou para Stage 3 (transferência); nunca 2 → 3.
- Chamada vista pela primeira vez já em Stage 3: não gera tarefa, só aviso.
- Campos da mensagem: copiados literalmente do cadastro; telefone do cadastro = Callee Number.
- URL, usuário e senha configuráveis (a URL muda com frequência).
- Modelo da mensagem definido (fica em `config/mensagem.txt`).

| # | Informação pendente | Quando |
|---|---|---|
| 1 | Se o login tem 2FA/captcha; quanto tempo a sessão dura | Fase 1–2 |
| 2 | Captura anonimizada do login, da tabela de chamadas e da Customer Data List (gerada pela ferramenta `recon`) | Fase 2 / 4 |
| 3 | Outros valores de `Call Status` além dos Stages; se Stage 3 pode voltar para Stage 1 | Fase 3 |
| 4 | Qual campo distingue ligações sucessivas do mesmo Callback Number (vem da captura) | Fase 2–3 |
| 5 | Formato/fuso de `Start Time`; formato de `Call Duration` e dos telefones | Fase 2 |
| 6 | O que acontece com a linha quando a chamada termina; se a tabela é paginada ou filtrada | Fase 2–3 |
| 7 | Se a Customer Data List pode ser aberta em outra aba sem derrubar a tabela | Fase 4 |
| 8 | Rótulos dos campos do formulário que correspondem a `nome`, `cpf`, `location`, `age` e `Phone` (vem da captura) | Fase 4 |
| 9 | Forma de integração com o Telegram (conta pessoal ou bot), destino, chat de teste e volume de mensagens | Antes da Fase 5 |
| 10 | Versão do Windows, se Node já está instalado, se pode usar o Edge, restrições de antivírus/proxy | Fase 1 / 7 |

## 3. Riscos técnicos que o Claude deve investigar antes de fechar a arquitetura

1. **Identidade da chamada.** O `Callback Number` localiza a chamada, mas se repete ao longo do dia. Se a deduplicação usar só o número, a segunda transferência do mesmo funcionário seria ignorada. É preciso um campo que separe ligações sucessivas (provavelmente `Start Time`). A posição da linha nunca serve como identidade.
2. **Transições perdidas.** Com atualização a cada segundo, uma ligação curta em Stage 1 pode passar para Stage 3 entre duas leituras e aparecer já em Stage 3. Decidido: nesse caso não há tarefa, só aviso, então essas transferências dependem de você notar o aviso.
3. **Monitoramento interrompido durante a consulta.** Se a pesquisa do cliente acontecer na mesma aba, a tabela fica sem leitura. Uma segunda aba resolve, se o site permitir.
4. **Leitura no meio da atualização.** Uma leitura parcial pode produzir linhas incompletas ou duplicadas. Isso pede leitura atômica e confirmação em leituras consecutivas.
5. **Navegador em segundo plano.** O Chromium reduz timers em janelas minimizadas ou ocultas, o que pode congelar a atualização da tabela.
6. **Login automático.** Tentativas repetidas com senha errada podem bloquear a conta no site. Por isso o bot faz uma única tentativa e depois passa para o login manual. A senha fica no `.env` em texto puro, a menos que se use o Gerenciador de Credenciais do Windows.
7. **URL que muda com frequência.** O bot deve navegar pelo menu, sem URLs internas fixas. Ao trocar a URL, o perfil do navegador perde a sessão.
8. **TDLib no Windows** (se a opção for conta pessoal). Compilar exige Visual Studio, CMake, vcpkg, OpenSSL, zlib e gperf, e o build é longo. Binários pré-compilados (`prebuilt-tdlib`) e o GramJS (JavaScript puro) evitam isso, mas cada opção tem seus próprios riscos de manutenção e de compatibilidade com o Node.
9. **Conta pessoal no Telegram.** Exige `api_id`/`api_hash`, há limites de `FLOOD_WAIT` e risco de restrição da conta se o uso parecer abusivo. O arquivo de sessão dá acesso total à conta e precisa de proteção.
10. **Confirmação de entrega.** É preciso saber se a mensagem foi realmente aceita pelo servidor e o que fazer quando o resultado é incerto, sem reenviar às cegas.
11. **Sessão expirada no site.** Detectar a expiração, pausar, avisar, aguardar o login manual e refazer a linha de base. As transferências ocorridas nesse intervalo podem ser perdidas.
12. **Alteração acidental do cadastro.** Abrir a edição traz o risco de um salvamento involuntário. A mitigação é nunca clicar em Salvar e bloquear requisições de escrita na aba de consulta.
13. **Pesquisa com 0 ou vários resultados**, ou telefone em formato diferente (DDI, máscara). A normalização e a verificação do telefone são obrigatórias.
14. **Seletores instáveis.** IDs gerados automaticamente ou classes CSS de framework podem mudar a cada deploy do site.
15. **Execução longa.** Vazamento de memória da página, recargas, quedas de rede e suspensão do Windows.
16. **Distribuição no Windows.** Node ausente, antivírus bloqueando o navegador ou binários nativos, encoding do console, caminhos com espaços ou acentos.
17. **Privacidade.** Dados de clientes (em especial CPF) em logs, *traces* do Playwright, capturas de tela ou *fixtures* commitadas por engano.

## 4. Critérios de conclusão da Fase 1

1. Documentos criados e coerentes: `CLAUDE.md`, `docs/ARQUITETURA.md`, `docs/DECISOES.md`, `docs/RISCOS.md`, `docs/PERGUNTAS_ABERTAS.md`, `docs/PLANO_DE_FASES.md`, `docs/RECONHECIMENTO.md`, `docs/PROGRESSO.md`.
2. Levantamento das opções de Telegram (conta pessoal via TDLib/GramJS e Bot API) pronto para sua decisão, sem nada instalado ou implementado.
3. Arquitetura cobrindo identidade por Callback Number e anomalias, linha de base, confirmação da transição Stage 1 → Stage 3 e descarte de Stage 2, estados da tarefa, estratégia de abas, login automático com *fallback* manual, configuração alterável sem recompilar, deduplicação em memória, envio incerto, sessão expirada e modo observação.
4. Nenhum seletor, URL ou comportamento do site inventado; toda suposição marcada como pendente.
5. Esqueleto mínimo: `npm ci`, `lint`, `typecheck` e `test` passando; `.gitignore`, `.gitattributes`, `.env.example` e `config/mensagem.txt` corretos.
6. Nenhum segredo ou dado pessoal no repositório.
7. Perguntas bloqueantes feitas a você e roteiro de reconhecimento pronto para executar no Windows.
8. Commit e push feitos, relatório entregue, e o Claude parou à espera da sua aprovação, sem iniciar a Fase 2.

## Como usar

1. Abra uma nova sessão do Claude Code neste repositório.
2. Cole todo o conteúdo de `docs/prompt-inicial.md` a partir da linha "Você vai atuar como…".
3. Responda às perguntas que ele fizer e revise os documentos da Fase 1 antes de autorizar a Fase 2.
4. Nas sessões seguintes, basta pedir: "Leia `CLAUDE.md` e `docs/PROGRESSO.md` e execute a Fase N".
