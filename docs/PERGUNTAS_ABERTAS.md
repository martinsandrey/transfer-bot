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

| ID    | Dúvida                                                                                                       | Fase |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---- |
| P-TG2 | Destino: chat privado, grupo ou canal? Chat de teste disponível?                                             | 5    |
| P-TG3 | Volume esperado de mensagens (por hora/dia) e horários                                                       | 5    |
| P-TG4 | (respondida: conta pessoal, GramJS) — falta o usuário criar api_id/api_hash e fazer o login                  | 5    |
| P-ED1 | Edge permitido (ver P-W1)                                                                                    | 2    |
| P-D1  | Distribuição (Fase 7): ZIP do GitHub + Node instalado, ou pacote com Node portátil? (recomendação na Fase 7) | 7    |
| P-S1  | Fuso horário do `Start Time` e do computador                                                                 | 2    |

## Suposições atualmente marcadas como TODO(confirmar)

- Discriminador de ocorrência (R1/P5), formato de `Start Time`/`Call Duration` (P6), valores de status (P4), sinais de
  login/sessão (P1/P2), tabela vazia vs. carregando (P3), 2ª aba (P9), forma da pesquisa (P10), rótulos do cadastro (P11).

## Suposições provisórias adotadas no código (2026-10-15) — confirmar com o recon

| Suposição                                                                                               | Onde                                                              | Pergunta                       |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| Discriminador de ocorrência = `Start Time` + `Callee Number` (texto cru)                                | `src/monitor/call-tracker.ts` (`discriminadorPadrao`)             | P5                             |
| A tabela é `<table>`/`role=table                                                                        | grid` e localizada pelo cabeçalho "Callback Number"/"Call Status" | `src/leitura/leitor-tabela.ts` | P3  |
| `Call Duration`: `SS`, `MM:SS` ou `HH:MM:SS`, senão `null`                                              | `parseDuracao`                                                    | P6                             |
| "Logado" = tabela de chamadas visível; "sessão expirada" = tabela ausente por ~5 s                      | `main.ts`, `LeitorTabelaHtml`                                     | P1/P2                          |
| Textos de status exatos: `Stage 1 Agent`, `Stage 2 Agent`, `Stage 3 Agent` (sem diferenciar maiúsculas) | `interpretarStatus`                                               | P4                             |
| `SITE_URL` do usuário é `http://` (sem criptografia) — informado em 2026-10-15; fica só no `.env` local | —                                                                 | —                              |

## Respostas obtidas pelo recon de 2026-10-16 (ver `docs/EVIDENCIAS.md`)

- **P3 (estrutura da tabela):** respondida — colunas, ordem e o 8º cabeçalho de resumo.
- **P5 (discriminador):** **Start Time** muda a cada nova ligação, inclusive na redisca sem a linha sumir; Callee não mudou nesses casos. Padrão `Start Time|Callee Number` mantido e confirmado como adequado. _Falta apenas_ confirmar o comportamento na transferência (Q1).
- **P6 (formatos):** Start Time `HH:MM:SS` sem data; Call Duration `HH:MM:SS`; Callback 6 dígitos; Callee 12 dígitos com zero à esquerda.
- **P7 (fim da chamada):** a linha some imediatamente.
- **P8 (atualização):** ~1×/s, janela visível.
- **P4 (status):** vistos `Stage 1 Ringing`, `Stage 1 Agent`, `Stage 1 Manual Call`, `Stage 3 Agent`; Stage 2 e Stage 4 existem (contadores do site).

## Novas perguntas (2026-10-16)

| ID  | Pergunta                                                                                                                                                                                                                                                                                                       | Por que importa                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Quando uma chamada é transferida, a **mesma linha** continua com o **mesmo Callback Number** (ex.: 908112) e só o status muda para `Stage 3 Agent`? Ou a linha some e aparece **outra** com outro Callback Number (na sua captura o `Stage 3 Agent` tinha `908301`, número diferente dos `9081xx` do Stage 1)? | Se o Callback Number mudar, a identidade por Callback Number não detecta a transferência; teria de ligar as duas linhas pelo **Callee Number**. Para confirmar: rodar `tabela` por 120–180 s **durante uma transferência real** |
| Q2  | O que são **Stage 2** e **Stage 4**? Existe `Stage 3 Ringing` (ou outro complemento) antes de `Stage 3 Agent`? `Stage 3` pode voltar a `Stage 1`?                                                                                                                                                              | Hoje só `Stage 1 Agent → Stage 3 Agent` gera tarefa; qualquer sequência que envolva Stage 4 gera aviso sonoro                                                                                                                   |
| Q3  | No texto da mensagem, `Line 1 number` deve ser o Callback Number **do Stage 1** (o funcionário que originou), mesmo que depois o Callback Number mude?                                                                                                                                                         | Define qual número vai para `{{callback number}}`                                                                                                                                                                               |
| Q4  | Pode rodar agora os demais comandos do recon (`login`, `menu`, `clientes`, `resultado`, `edicao`, `abas`)?                                                                                                                                                                                                     | Sem eles não há login automático, consulta ao cliente nem mensagem real                                                                                                                                                         |

## Decisão do usuário sobre dados faltando (2026-10-16)

Falta de dado numa linha da tabela é normal. A linha problemática é **ignorada sozinha**; o sistema não para nem invalida a leitura. Implementação:

- Uma linha só é usada se tiver Callback Number, Callee Number, Call Status e Start Time (Call Duration é opcional).
- Linhas curtas demais ou com mais células que cabeçalhos também são só ignoradas.
- Se a linha incompleta tem Callback Number, a chamada fica "congelada" no rastreador (não conta como sumida nem muda de estado).
- Só a falta de um **cabeçalho** obrigatório invalida a leitura. Se **todas** as linhas forem ignoradas por muito tempo, há um aviso (possível mudança de layout).

## Resposta do recon de 2026-10-16 sobre o cadastro (`clientes`, `resultado`, `edicao`)

As três capturas mostram a **tela de monitoramento**, não a Customer Data List. O recon foi melhorado: agora esses comandos capturam **todas as abas abertas** e todos os seus frames.

| ID  | Pergunta                                                                                                                                                                                                                             | Por que importa                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Ao clicar em **Customer Data List** no menu lateral, o que acontece: abre uma **janela flutuante dentro da mesma página**, abre uma **nova aba/janela do navegador**, ou a **página inteira muda**?                                  | Define se a consulta usa 2ª aba, janela interna ou navegação, e se a tabela de chamadas continua sendo lida                     |
| R2  | Repita com a tela **realmente aberta e visível** (e, no `resultado`, com a busca feita): rode `clientes`, depois `resultado` (pesquise um telefone e deixe o resultado na tela) e `edicao` (abra a edição de um cliente, sem salvar) | Sem isso não há campo `Phone`, botão `Search`, lista de resultados nem os rótulos do formulário (nome, CPF, localização, idade) |

## Q1 respondida (2026-10-16) e Q3 por hipótese

- **Q1:** na transferência a linha do Stage 1 some e surge outra em Stage 3 com **outro Callback Number** e o **mesmo Callee**. Detecção por Callee implementada. (Ver EVIDENCIAS.)
- **Q3 (CONFIRMADA pelo usuário em 2026-10-16):** na transferência o Callback Number troca, e o texto preparado deve conter o Callback Number **antigo, do Stage 1 Agent** em `Line 1 number`.
- **Novas dúvidas:** (a) existe atraso entre a linha do Stage 1 sumir e a do Stage 3 aparecer? (a janela padrão é 60 s); (b) quando Stage 1 vai para **Stage 2**, a linha também troca (Callback `9082xx`)?

## Fluxo do cadastro confirmado pelo usuário (2026-10-16)

Callee Number → página **Customer Data List** → pesquisa pelo cliente usando o Callee Number → as demais informações da mensagem estão lá.
**Regra: se faltar algum dado necessário, deixar o campo vazio** (não é erro). Implementado em `ConsultaDeCliente` (lógica pronta e testada com página falsa);
o contato com a página (`PaginaClientesPlaywright`) foi implementado com a evidência do recon (falta validar no site real). Telefone ausente no cadastro: segue e `Ph` fica vazio; telefone diferente do Callee: cliente errado (não envia).

## Passo do botão Edit (2026-10-16, informado pelo usuário)

Entre pesquisar e ler o cadastro, o bot precisa **clicar no botão Edit na linha do cliente pesquisado** (primeiro resultado). Está na interface (`abrirEdicaoDoPrimeiro`).
Precisamos da evidência de como é esse botão na linha de resultados (rótulo/ícone, posição) — capturar com `resultado` (resultado na tela). É a única ação de clique no cadastro; Salvar/Update/Delete continuam proibidos e as requisições de escrita serão bloqueadas na aba de consulta.

## Fim da consulta (2026-10-16)

Após preparar a mensagem, voltar para **Voice Call Status** e **nunca confirmar** a edição do cliente (fechar sem salvar). Implementado no contrato `PaginaClientes`. Falta evidência (R1) de como voltar e de como fechar o formulário de edição sem confirmar (botão/ícone de fechar ou cancelar; se pede confirmação ao descartar).

## R1 respondida em parte (2026-10-16)

Clicar no menu lateral substitui a página atual; para voltar, clicar em **Voice Call Status** no menu lateral — sem nenhuma pergunta de confirmação ao sair do formulário de edição. Segue em aberto: como a Customer Data List aparece/abre ao clicar no menu e a captura `resultado`/`edicao` (R2).

## P11 respondida em parte (2026-10-16)

Rótulos do formulário de edição: Name, ID number, Date of birth, Phone, Address (ver EVIDENCIAS). Código: `src/consulta/rotulos.ts`. Segue em aberto a estrutura HTML do formulário (captura `edicao`).

## Customer Data List — o que as capturas responderam e o que falta (2026-10-16)

- **R1 respondida:** a lista e a edição abrem como iframes na mesma página (1 aba); a tabela de chamadas some enquanto elas estão abertas.
- **Falta (recon melhorado, rodar de novo):** nomes/ids reais dos campos do formulário de busca (qual é o `Phone`), o botão de busca, **qual dos links da coluna Action é o Edit** (ícone/`alt`/`href`) e os nomes dos campos do formulário de edição. O recon antigo não capturava controles dentro de tabelas.
- **Decisão pendente:** a lista de resultados já traz `Name`, `ID Number`, `Date of Birth` e `Phone`, mas **não** `Address`. Seguiremos o fluxo combinado (clicar em Edit e ler o formulário), que traz todos os campos.
- **Segurança:** bloqueio de requisições (`update.php`, `delete.php`, escrita em `/modules/cc_cds/`) implementado em `src/consulta/bloqueio.ts`, a ser ligado ao `context.route` do adaptador.
