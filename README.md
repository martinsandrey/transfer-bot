# Transfer Bot

Programa para Windows que monitora a tabela de chamadas de um sistema web, detecta transferências
(`Stage 1 Agent` → `Stage 3 Agent`), consulta o cliente e prepara a mensagem para o Telegram.

> **Estado atual (em desenvolvimento):** detecção de transferências, fila, montagem da mensagem e modo simulado estão prontos.
> **Ainda não existe:** login automático no site (o login é manual). A consulta ao cadastro e o envio ao Telegram existem, mas o envio real só liga com `SEND_MODE=live`.
> Por isso, hoje o programa **nunca envia nada**: `SEND_MODE=observacao` é o único modo aceito.
> Andamento detalhado em [`docs/PROGRESSO.md`](docs/PROGRESSO.md); regras do projeto em [`CLAUDE.md`](CLAUDE.md).

## Pré-requisitos

- Windows 10/11, **Node.js LTS** ([nodejs.org](https://nodejs.org)) e o **Microsoft Edge** (já vem no Windows).
- Internet para a instalação das dependências (uma vez).

## Instalação

1. Baixe o projeto (ZIP do GitHub → "Extrair tudo", de preferência numa pasta curta como `C:\TransferBot`).
2. Dê dois cliques em **`instalar.bat`**.
3. Dê dois cliques em **`configurar.bat`** e preencha `SITE_URL` (endereço do sistema). Salve e feche.

## Uso

- **`simular.bat`** — roda um cenário **fictício** (não acessa o site) para ver o programa funcionando.
- **`iniciar.bat`** — abre uma janela do Edge **exclusiva do bot** (não mexe no seu Edge pessoal). Faça o login nela e abra a tela da tabela
  de chamadas. O programa passa a monitorar. Quando detecta uma transferência, avisa com som e **mostra no console a mensagem preparada** (por enquanto só com `Ph` e `Line 1 number`; `NAME`, `CPF`, `Location` e `Age` ficam em branco, porque a consulta ao cadastro ainda não existe). Nada é enviado. Para parar: `Ctrl+C` ou digite `sair`.
- **`recon.bat`** — ferramenta de reconhecimento do site (gera um relatório **anonimizado** para o desenvolvimento). Roteiro: [`docs/RECONHECIMENTO.md`](docs/RECONHECIMENTO.md).

## Como trocar URL, usuário e senha

Abra `configurar.bat` (ou edite o arquivo `.env` com o Bloco de Notas) e altere `SITE_URL`, `SITE_USUARIO`, `SITE_SENHA`. Não precisa reinstalar nem recompilar.
Ao trocar a URL, o navegador pode pedir novo login.

## Como editar o modelo da mensagem

Edite `config\mensagem.txt` (também pelo `configurar.bat`). Use exatamente os marcadores `{{nome}}`, `{{cpf}}`, `{{location}}`, `{{age}}`, `{{Phone}}` e
`{{callback number}}`. Se faltar algum ou houver um desconhecido, o programa avisa ao iniciar e não começa.

## Modo observação e envio real

Hoje só existe o modo **observação** (padrão): o programa detecta, consulta e **mostra a prévia no console**, sem enviar. O envio real
(`SEND_MODE=live`) exige `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` no `.env`, o login do Telegram feito antes e uma confirmação digitada (`ENVIAR`) a cada inicialização.

## Telegram (conta pessoal)

1. Em https://my.telegram.org → "API development tools", crie o app e copie `api_id` e `api_hash` para o `.env` (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`). Trate o `api_hash` como senha.
2. `telegram.bat login` (ou abra o `telegram.bat` e escolha 1) — digite telefone, código e (se tiver) a senha 2FA. Só a sessão é salva, na pasta de dados do usuário (fora do projeto); ela dá acesso à conta, não a compartilhe.
3. `telegram.bat chats` — mostra os IDs das conversas; ponha o escolhido em `TELEGRAM_DESTINO` (o padrão `me` são as suas Mensagens Salvas, ideal para testar).
4. `telegram.bat teste` — envia uma mensagem de teste (sem dados de cliente).
5. Só então use `SEND_MODE=live`.

## Segurança e privacidade

- Senhas ficam só no `.env` (ignorado pelo git). **Não compartilhe** esse arquivo nem o coloque em pastas sincronizadas (OneDrive, etc.).
- Se o endereço do sistema começa com `http://` (sem `s`), usuário e senha trafegam **sem criptografia** pela rede. Prefira `https://` se existir.
- Os logs ficam em `%LOCALAPPDATA%\TransferBot\logs`, com telefones mascarados e **sem** dados de clientes.
- O programa só **lê** o site: nunca clica em salvar, atualizar ou excluir.
- Nada é gravado como histórico de transferências; o estado fica só na memória.

## Solução de problemas

| Problema                         | O que fazer                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| "Node.js não encontrado"         | Instale o Node LTS e rode `instalar.bat` de novo.                                                                           |
| O Edge não abre                  | Coloque `NAVEGADOR=chromium` no `.env` e rode `npx playwright install chromium` no Prompt de Comando, na pasta do programa. |
| Antivírus/Defender pergunta algo | Permita o navegador automatizado e a pasta do programa.                                                                     |
| Letras estranhas no console      | Os `.bat` já usam UTF-8; abra pelo `.bat`, não pelo atalho do Node.                                                         |
| "A tabela está ilegível"         | O site mudou ou a tela errada está aberta. Abra a tela da tabela de chamadas.                                               |
| Sessão expirada                  | O programa avisa com som e espera: faça o login de novo na janela do navegador.                                             |
| Janela minimizada / coberta      | Mantenha a janela do bot visível e não minimizada (o Windows pode reduzir a atualização).                                   |

## Para desenvolvedores

`npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run simular`. Documentação em `docs/`.
