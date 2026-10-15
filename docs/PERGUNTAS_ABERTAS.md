# Perguntas em aberto e respostas recebidas

Marcações no código `TODO(confirmar)` apontam para itens daqui. Respostas ganham data.

## Já respondidas (do prompt inicial, 2026-10-15)

- Regra de cinco minutos: **descartada**; não há critério de tempo.
- Stage 2 existe; Stage 1 → Stage 2 não gera tarefa. Só **Stage 1 Agent → Stage 3 Agent** interessa. Nunca Stage 2 → Stage 3.
- Identidade: Callback Number (nunca em 2 linhas ao mesmo tempo; repete ao longo do dia). Dedup por ocorrência.
- Chamada vista pela primeira vez em Stage 3: sem tarefa, só aviso.
- Campos da mensagem: copiados literalmente do cadastro; telefone do cadastro = Callee Number.
- URL, usuário e senha configuráveis; a URL muda com frequência.
- Modelo da mensagem definido (`config/mensagem.txt`).

## Respostas recebidas após a Fase 1 (2026-10-15)

- **P-W1:** Windows 11; Node LTS mais recente já instalado; qualquer navegador serve; só o Windows Defender (sem proxy/antivírus corporativo). → Edge (`msedge`) como padrão; Chromium do Playwright como alternativa. Confirmar a versão exata do Node em `node -v` na Fase 2.
- **P-W2:** sem 2FA e sem captcha, só usuário e senha. Duração da sessão: **desconhecida** (será observada; o tratamento de sessão expirada continua obrigatório).
- **P-W3:** reexplicada em linguagem simples; o usuário aprovou a Fase 2 (2026-10-15). Roteiro executável em `docs/RECONHECIMENTO.md` (seção "Passo a passo"). **Aguardando a saída do recon.**
- **P-TG1:** a mensagem **precisa vir da conta pessoal** do usuário → opções A (TDLib) ou B (GramJS) em DECISOES D9; Bot API (C) descartada. Escolha entre A e B fica para a Fase 5; P-TG2..P-TG4 seguem em aberto.

## Perguntas bloqueantes (feitas ao usuário no relatório da Fase 1)

| ID    | Pergunta                                                                                                                                                    | Por que importa                                                                | Resposta padrão proposta                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| P-W1  | Versão do Windows (10/11), o **Node.js já está instalado** (versão)? Posso usar o **Microsoft Edge** como navegador do bot? Há proxy/antivírus corporativo? | Define `NAVEGADOR`, o instalador (Fase 7) e se o download do Chromium é viável | Windows 10/11, sem Node (o instalador orienta a instalar o Node 24 LTS), Edge permitido, sem proxy |
| P-W2  | O login tem **2FA/captcha**? Quanto dura uma sessão (horas/dias)?                                                                                           | Define o fluxo de login manual e a frequência de "sessão expirada"             | Assumir que pode haver captcha/2FA ocasional; login automático desligado por padrão                |
| P-W3  | Você consegue rodar o `npm run recon` (Fase 2) no Windows e me enviar a saída revisada? (roteiro em `docs/RECONHECIMENTO.md`)                               | Sem evidência não há seletores, colunas, formatos nem identidade de ocorrência | Sim; faremos assim que a Fase 2 for aprovada                                                       |
| P-TG1 | Telegram: a mensagem **precisa aparecer como sendo sua** (conta pessoal) ou **pode vir de um bot**?                                                         | Escolha entre A/B (conta pessoal) e C (Bot API) — ver DECISOES D9              | Bot API, por ser mais simples e seguro, se não houver exigência de aparecer como você              |

(Máx. 4 por vez. Demais perguntas abaixo ficam para depois de evidência/decisão.)

## Dependem de evidência do site (Fase 2/4, via `recon`)

| ID  | Dúvida                                                                                                        | Fase |
| --- | ------------------------------------------------------------------------------------------------------------- | ---- |
| P1  | 2FA/captcha no login (ver P-W2); sinais de "logado" e "não logado"                                            | 2    |
| P2  | Duração típica da sessão; como o site sinaliza expiração (redirect, 401/403)                                  | 2    |
| P3  | Estrutura da tabela de chamadas (cabeçalhos exatos, DOM, paginação/filtros, tabela vazia/atualizando)         | 2    |
| P4  | Todos os valores de `Call Status` (além dos 3 Stages); Stage 3 pode voltar a Stage 1?                         | 2–3  |
| P5  | Campo que distingue ligações sucessivas do mesmo Callback Number (Start Time? ID oculto? Callee?)             | 2–3  |
| P6  | Formato e fuso de `Start Time`; formato de `Call Duration`; formato dos telefones (DDI, máscara)              | 2    |
| P7  | O que acontece com a linha quando a chamada termina (some? muda status? fica?)                                | 2–3  |
| P8  | Como a tabela se atualiza (polling/XHR/WebSocket) e se continua atualizando em aba sem foco/janela minimizada | 2    |
| P9  | A Customer Data List abre em **outra aba** sem derrubar a tabela/sessão?                                      | 4    |
| P10 | Como a pesquisa por Phone é feita (requisição); como é a tela com 0/1/N resultados                            | 4    |
| P11 | Rótulos/campos do formulário de edição para nome, cpf, location, age, Phone                                   | 4    |
| P12 | Há botões/ações de escrita na tela de edição que devemos reconhecer para nunca clicar (nomes)                 | 4    |

## Dependem de decisão do usuário (Fases 5–7)

| ID    | Dúvida                                                                                                         | Fase |
| ----- | -------------------------------------------------------------------------------------------------------------- | ---- |
| P-TG2 | Destino: chat privado, grupo ou canal? Chat de teste disponível?                                               | 5    |
| P-TG3 | Volume esperado de mensagens (por hora/dia) e horários                                                         | 5    |
| P-TG4 | Se conta pessoal: aceita criar `api_id`/`api_hash` em my.telegram.org e fazer login por código/2FA no console? | 5    |
| P-ED1 | Edge permitido (ver P-W1)                                                                                      | 2    |
| P-D1  | Distribuição (Fase 7): ZIP do GitHub + Node instalado, ou pacote com Node portátil? (recomendação na Fase 7)   | 7    |
| P-S1  | Fuso horário do `Start Time` e do computador                                                                   | 2    |

## Suposições atualmente marcadas como TODO(confirmar)

- Discriminador de ocorrência (R1/P5), formato de `Start Time`/`Call Duration` (P6), valores de status (P4), sinais de
  login/sessão (P1/P2), tabela vazia vs. carregando (P3), 2ª aba (P9), forma da pesquisa (P10), rótulos do cadastro (P11).
