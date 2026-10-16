# Evidências do site (recon)

Fatos **confirmados** por saídas do `npm run recon` e por captura de tela enviadas pelo usuário. Tudo que não está aqui continua `TODO(confirmar)`.
Não há dados pessoais neste arquivo: telefones e horários reais foram substituídos por descrições de formato.

## Tabela de chamadas — recon de 2026-10-16 (Windows, Edge; série de 60 s, 60 leituras)

| Fato                                                                                                                                                                                                                                                       | Evidência                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Página em `/modules/index.php` (caminho relativo); layout feito de tabelas aninhadas (classes `dhtmlx_*`)                                                                                                                                                  | `01-tabela.json`              |
| Colunas, **nesta ordem**: `ID`, `Callee Number`, `Callback Number`, `Call Status`, `Start Time`, `Call Duration`, `Action`                                                                                                                                 | captura de tela + série       |
| O cabeçalho tem um **8º item de resumo** no fim (`Manual Call： N Stage 1：N Stage 2：N Stage 3：N Stage 4：N`, dois-pontos largo) que as linhas de dados **não** têm: linhas de **7 células** × 8 cabeçalhos. Causa do erro "número de células diferente" | série                         |
| `ID` é só o número da linha (1, 2, 3…): **não** serve de identidade                                                                                                                                                                                        | série (valor muda de posição) |
| **Callback Number**: 6 dígitos (ramal do funcionário, ex.: `9081xx`; um Stage 3 aparece como `9083xx`)                                                                                                                                                     | captura de tela               |
| **Callee Number**: 12 dígitos com zero à esquerda (`0` + DDD + celular, ex.: `011…`)                                                                                                                                                                       | captura de tela               |
| **Start Time**: só horário `HH:MM:SS`, sem data                                                                                                                                                                                                            | captura de tela               |
| **Call Duration**: `HH:MM:SS`; **volta para `00:00:01` quando o Start Time muda**                                                                                                                                                                          | série                         |
| Valores de **Call Status** vistos: `Stage 1 Ringing`, `Stage 1 Agent`, `Stage 1 Manual Call`, `Stage 3 Agent` (tela). Os contadores do cabeçalho mostram também `Stage 2` e `Stage 4`                                                                      | série + tela                  |
| Transição vista em 60 s: `Stage 1 Ringing → Stage 1 Agent` (7×). **Nenhum 1→3 foi observado**                                                                                                                                                              | `03-tabela-analise.json`      |
| Ao terminar a chamada, a **linha some na hora** (8× a partir de Stage 1 Agent; 1× a partir de Manual Call)                                                                                                                                                 | análise                       |
| **Redisca**: o mesmo Callback Number troca de Start Time **sem a linha sumir**, com o mesmo Callee (2×); outras 6× a linha sumiu e voltou com outro Start Time                                                                                             | análise                       |
| Nenhum Callback Number repetido no mesmo instante (0 em 60 leituras); ordem das linhas estável (0 reordenações)                                                                                                                                            | análise                       |
| A tabela muda ~1×/s (58 de 60 leituras com mutações; intervalo mediano 1006 ms). Janela visível durante o teste                                                                                                                                            | análise                       |
| Não há captcha/2FA na tela de tabela; sem iframe nem Shadow DOM nesta tela (a tabela foi achada na página principal)                                                                                                                                       | `01-tabela.json`              |

## Consequências no código

- **Leitor**: alinha pelas posições dos cabeçalhos; aceita linhas com menos células que cabeçalhos (desde que cubram as colunas necessárias) e rejeita as com mais.
- **Status**: `interpretarStatusDetalhado` lê `Stage N <complemento>`. `Ringing → Agent` é normal (antes gerava aviso falso). Transferência = `Stage 1 Agent → Stage 3 Agent`.
- **Identidade**: `Start Time` + `Callee Number` (padrão) está de acordo com a evidência (redisca muda o Start Time).

## Ainda sem evidência (ver PERGUNTAS_ABERTAS)

- Como a linha se comporta **na transferência** (mantém o Callback Number? aparece outra linha, com outro Callback Number?).
- Significado de Stage 2 e Stage 4; se existe `Stage 3 Ringing`.
- Tela de login, menu, Customer Data List, resultado de busca e edição do cliente; teste de 2ª aba; duração da sessão.

## Estrutura geral da página — recon de 2026-10-16 (comandos `clientes`, `resultado`, `edicao`)

As três capturas saíram **praticamente idênticas**: todas mostram a tela de monitoramento, e **não** a Customer Data List (ver "Ainda sem evidência").

| Fato                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Evidência             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Tudo acontece em `/modules/index.php` (página principal) com **iframes** de `/modules/cc_monitor/…`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `frames` das capturas |
| A **tabela de chamadas está num iframe**: `/modules/cc_monitor/curcall_in.php` (2 tabelas aninhadas: a de fora, classe `adminlist`, tem o 8º cabeçalho de resumo; a de dentro tem exatamente os 7 cabeçalhos)                                                                                                                                                                                                                                                                                                                                                                                            | frame 6               |
| Há outra tabela de chamadas em `/modules/cc_monitor/curcall_out.php` com colunas `ID, Caller Number, Callee Number, Call Status, Start Time, Action` (status como `Initial Status`, `Voice Ringing`, `Voice Call`): **não** tem Callback Number, então não é a nossa                                                                                                                                                                                                                                                                                                                                     | frame 5               |
| `/modules/cc_monitor/controler.php` mostra a lista de "Broadcast"/campanhas e controles de envio (não usar)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | frame 7               |
| Menu lateral = árvore (dhtmlx, linhas de classe `standartTreeRow`) com os itens: Campaign Settings, Broadcast, Broadcast Flow Settings, Multi-transfer Agent Settings, Outbound Voice List, Number Range Auto Pause Settings, **Customer Data List**, Upload Audio File, Password Change, Agent Queue, Mobile Number, System Monitoring, Voice Call Status, Voice Records, Manual Records, Manual Dial Records, Number Lookup Record, Delete Records, Recording Records, Concurrency Status, PBX Management, VOIP Extension, Online Management, Extension IP Connection Query, Agent Transfer Management | tabelas 11–35         |
| Janelas internas do sistema são do tipo dhtmlx (`dhtmlx_wins_*`); 4 frames `about:blank` vazios nas capturas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | frames 0–3            |
| O cabeçalho da tabela de chamadas resume os contadores atuais: `Manual Call： N Stage 1：N Stage 2：N Stage 3：N Stage 4：N`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | frame 6               |

## Ainda sem evidência

- **Customer Data List**: não foi capturada. Os frames de janelas ficaram vazios, o que indica que a tela **não estava aberta/visível** (ou abriu em outra aba que não foi capturada).
  Faltam: como a tela abre (janela interna, nova aba, ou troca de página), o campo `Phone`, o botão `Search`, a tabela de resultados e o formulário de edição.

## Transferência real — relato do usuário em 2026-10-16 (Q1 respondida)

Numa transferência real, o console mostrou avisos `visto_primeira_vez_stage3` para os Callback Numbers `***8301` e `***8304`, e **nenhuma** transferência detectada. Conclusão:

- **Na transferência a linha NÃO continua.** A linha do Stage 1 (Callback `9081xx`) **some** e aparece **outra linha** em `Stage 3 Agent` com **outro Callback Number** (`9083xx`, o do agente do Stage 3). O Callee Number é o mesmo.
- Portanto a transferência não é uma mudança de status na mesma linha; é **troca de linha com o mesmo Callee Number**. A detecção passou a ligar a linha nova de Stage 3 à última linha `Stage 1 Agent` do mesmo Callee (janela `JANELA_TRANSFERENCIA_SEG`, padrão 60 s).
- `Line 1 number` da mensagem = **Callback Number da linha do Stage 1** (o funcionário que originou). Confirmado pelo usuário (Q3).
- A linha de Stage 3 pode sumir e voltar na tabela; isso não repete aviso nem transferência.

## Rótulos do formulário de edição — informados pelo usuário em 2026-10-16

| Campo da mensagem | Rótulo no formulário                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `{{nome}}`        | **Name**                                                                        |
| `{{cpf}}`         | **ID number**                                                                   |
| `{{age}}`         | **Date of birth** (o conteúdo vai literalmente para `Age:`, sem calcular idade) |
| `{{Phone}}`       | **Phone**                                                                       |
| `{{location}}`    | **Address**                                                                     |

Falta ainda a captura `edicao` para saber COMO o rótulo se liga ao campo no HTML (e não adivinhar seletores).
