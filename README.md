# Transfer Bot

Programa para Windows que abre um navegador dedicado, monitora a tabela de chamadas (Voice Call Status) de um sistema web, detecta
transferências (`Stage 1 Agent` → `Stage 3 Agent`), consulta o cliente na Customer Data List (**somente leitura**), monta a mensagem
de `config\mensagem.txt` e a envia pelo Telegram (conta pessoal). Por padrão ele só **mostra** a mensagem no console (modo observação).

Andamento: [`docs/PROGRESSO.md`](docs/PROGRESSO.md) · regras do projeto: [`CLAUDE.md`](CLAUDE.md).

## Pré-requisitos

- Windows 10/11 e o **Microsoft Edge** (já vem no Windows).
- **Node.js LTS** (versão 22.13 ou mais nova; recomendado o LTS atual) — [nodejs.org](https://nodejs.org).
- Internet para instalar as dependências (na primeira vez e nas atualizações).

## Instalação (uma vez)

1. Baixe o projeto (ZIP do GitHub → "Extrair tudo", numa pasta curta como `C:\TransferBot`) ou clone com git.
2. Dê dois cliques em **`instalar.bat`**. Ele confere o Node, instala as dependências e prepara o programa.
3. Dê dois cliques em **`configurar.bat`** e preencha o `.env` (veja abaixo). **Salve em UTF-8** (Bloco de Notas → Salvar como → Codificação UTF-8), principalmente se usar nomes em chinês.
4. Para enviar ao Telegram: siga a seção "Telegram" mais abaixo.

## Uso diário

- **`iniciar.bat`** — abre uma janela do Edge **exclusiva do bot** (não mexe no seu Edge pessoal).
  - Aparece a verificação do botão quadrado: **clique você mesmo** (o programa nunca faz isso).
  - Login: manual, ou automático se `LOGIN_AUTOMATICO=true` (preenche `SITE_USUARIO`/`SITE_SENHA` **uma única vez**, depois da verificação).
  - Quando detecta uma transferência, o programa consulta o cliente, volta para a Voice Call Status e mostra/envia a mensagem.
  - Para parar: `Ctrl+C` ou digite `sair`. Ele termina a tarefa em andamento e avisa o que ficou pendente.
- **`atualizar.bat`** — baixa a versão nova (precisa do Git; sem Git, baixe o ZIP novo e copie por cima mantendo o `.env`).
- **`simular.bat`** — cenário **fictício** (não acessa o site), para ver o programa funcionando.
- **`recon.bat`** — ferramenta de reconhecimento do site (relatório **anonimizado**). Não rode junto com o `iniciar.bat` (usam o mesmo navegador). Roteiro: [`docs/RECONHECIMENTO.md`](docs/RECONHECIMENTO.md).

## Configuração (`.env`)

Abra com `configurar.bat`. Principais itens (a lista completa, comentada, está em `.env.example`); não precisa reinstalar nem recompilar:

| Variável                                         | Para quê                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `SITE_URL`                                       | Endereço do sistema (obrigatório).                                          |
| `SITE_USUARIO`, `SITE_SENHA`, `LOGIN_AUTOMATICO` | Login automático (opcional).                                                |
| `SEND_MODE`                                      | `observacao` (padrão: só mostra) ou `live` (envia de verdade).              |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`           | Credenciais do Telegram (my.telegram.org).                                  |
| `TELEGRAM_DESTINO`                               | `me`, nome exato do canal/grupo (aceita chinês), `@usuario` ou ID.          |
| `VALIDADE_MENSAGEM_MIN`                          | Mensagem mais velha que isso não é enviada (padrão 15; 0 = nunca descarta). |
| `JANELA_TRANSFERENCIA_SEG`                       | Tempo máximo entre o Stage 1 sumir e o Stage 3 aparecer (padrão 60).        |
| `NAVEGADOR`                                      | `msedge` (padrão) ou `chromium`.                                            |

Ao trocar a URL, o navegador pode pedir novo login.

## Modelo da mensagem

Edite `config\mensagem.txt` (também pelo `configurar.bat`). Marcadores obrigatórios, exatamente assim: `{{nome}}`, `{{cpf}}`, `{{location}}`,
`{{age}}`, `{{Phone}}` e `{{callback number}}`. Se faltar algum ou houver um desconhecido, o programa avisa ao iniciar e não começa.
Campos que não existirem no cadastro ficam vazios. `Line 1 number` é o Callback Number **antigo** (o do Stage 1).

## Telegram (conta pessoal)

1. Em https://my.telegram.org → "API development tools", crie o app e copie `api_id` e `api_hash` para o `.env`. Trate o `api_hash` como senha.
2. `telegram.bat` → **1 (login)**: telefone, código e (se tiver) senha 2FA, digitados no console. Só a sessão é salva (`%LOCALAPPDATA%\TransferBot\telegram\sessao.txt`); ela dá acesso à conta, **não a compartilhe**.
3. `telegram.bat` → **2 (chats)** mostra os IDs; ponha o nome exato do canal ou o ID em `TELEGRAM_DESTINO`.
4. `telegram.bat` → **3 (teste)** envia uma mensagem de teste (sem dados de cliente).
5. Roteiro recomendado: modo observação → `SEND_MODE=live` com `TELEGRAM_DESTINO=me` → canal definitivo. Com `live`, o programa pede que você digite `ENVIAR` a cada inicialização.

## Segurança e privacidade

- Senhas e `api_hash` ficam só no `.env` (ignorado pelo git). **Não compartilhe** esse arquivo nem o coloque em pastas sincronizadas (OneDrive etc.).
- Se o endereço começa com `http://` (sem `s`), usuário e senha trafegam **sem criptografia** na rede. Prefira `https://` se existir.
- Logs em `%LOCALAPPDATA%\TransferBot\logs`: telefones mascarados e **nenhum** dado de cliente (nome, CPF, localização, idade).
- O programa só **lê** o site: bloqueia qualquer requisição de escrita/exclusão do cadastro e nunca clica em salvar, atualizar ou excluir.
- Não há histórico de transferências em arquivo ou banco; o estado fica só na memória (o Telegram é o histórico).
- A verificação do botão quadrado e qualquer 2FA são sempre feitos por você.

## Solução de problemas

| Problema                             | O que fazer                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| "Node.js não encontrado" / antigo    | Instale o Node LTS atual e rode `instalar.bat` de novo.                                               |
| "Cannot find module ..."             | Rode `instalar.bat` (ou `atualizar.bat`) para reinstalar as dependências.                             |
| O Edge não abre                      | Coloque `NAVEGADOR=chromium` no `.env` e rode `npx playwright install chromium` na pasta do programa. |
| Antivírus/Defender pergunta algo     | Permita o navegador automatizado e a pasta do programa.                                               |
| Letras estranhas no console          | Abra pelo `.bat`, não pelo atalho do Node.                                                            |
| "A tabela está ilegível"             | O site mudou ou a tela errada está aberta; o programa tenta abrir a Voice Call Status sozinho.        |
| Sessão do site expirada              | O programa avisa com som e refaz o login (automático, se ligado; senão, faça na janela).              |
| Canal do Telegram em chinês não acha | Salve o `.env` em UTF-8 ou use o ID (`telegram.bat` → 2).                                             |
| Mensagem "NÃO foi enviada ... velha" | O envio demorou mais que `VALIDADE_MENSAGEM_MIN`; confira a conexão/Telegram.                         |
| Envio "INCERTO"                      | Confira o canal no Telegram antes de reiniciar; o programa nunca reenvia sozinho nesse caso.          |
| Janela minimizada / coberta          | Mantenha a janela do bot visível e não minimizada (o Windows pode reduzir a atualização).             |

## Para desenvolvedores

`npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run simular`. Documentação em `docs/`.
