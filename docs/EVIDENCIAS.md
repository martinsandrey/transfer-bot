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
