# Transfer Bot

Programa para Windows que abre um navegador dedicado, monitora a tabela de chamadas (Voice Call Status) de um sistema web, detecta
transferências da linha 1 para a linha 2 (`Stage 1 Agent` ou `Stage 1 Manual Call` → `Stage 2`, funcionário com antepenúltimo dígito 2, ex.: `9082xx`; a linha 3 é ignorada), consulta o cliente na Customer Data List (**somente leitura**), monta a mensagem
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

- **`iniciar.bat`** — abre uma janela do Edge **exclusiva do bot** (não mexe no seu Edge pessoal). Roda por um **supervisor**: se o programa fechar sozinho (queda, página travada que a recarga não resolveu, navegador fechado), ele é reaberto em 5 s com um aviso do Windows; com envio real ligado, digite a senha de liberação de novo na janela. Para parar de vez: digite `sair`, aperte Ctrl+C ou feche a janela. Se reabrir 6 vezes em 10 minutos, desiste e avisa. Erros de configuração/senha/Telegram sem login não são reabertos.
  - Aparece a verificação do botão quadrado: **clique você mesmo** (o programa nunca faz isso).
  - Login: manual, ou automático se `LOGIN_AUTOMATICO=true` (preenche `SITE_USUARIO`/`SITE_SENHA` **uma única vez**, depois da verificação).
  - Quando detecta uma transferência, o programa consulta o cliente, volta para a Voice Call Status e mostra/envia a mensagem.
  - Para parar: `Ctrl+C` ou digite `sair`. Ele termina a tarefa em andamento e avisa o que ficou pendente.
- **`atualizar.bat`** também confere o seu `.env`: acrescenta no fim as variáveis novas do `.env.example` (com comentário e valor padrão) e guarda a cópia anterior em `.env.bak`. Nunca altera nem apaga o que você já tem.
- No relatório aberto pelo `relatorio.bat`, o botão **Adicionar transferência manual** pede nome, CPF, telefone e Line 1 number (e a data e hora, já preenchida com agora). Location, Age e Occupation ficam vazios. Fica gravada em `registros/transferencias-manuais.txt`, conta como transferência normal do funcionário da Line 1 number e pode ser marcada como callback depois. Nada é enviado ao Telegram.
- **`diagnostico.bat`** — confere tudo e diz em português o que está errado: versão do Node, `.env` válido e variáveis novas que faltam nele, modelo da mensagem, pastas com permissão de gravação, se o bot já está aberto, Edge abrindo o site (sem login, sem janela), sessão do Telegram e os grupos encontrados, notificações do Windows ligadas, fuso do relógio e um resumo do log mais recente (quantas vezes o programa foi aberto, avisos e erros). Não altera nada e não envia nada. Rode antes de iniciar quando algo não funcionar.
- **`atualizar.bat`** — baixa a versão nova (precisa do Git; sem Git, baixe o ZIP novo e copie por cima mantendo o `.env`).
- **`simular.bat`** — cenário **fictício** (não acessa o site), para ver o programa funcionando.
- **`recon.bat`** — ferramenta de reconhecimento do site (relatório **anonimizado**). Não rode junto com o `iniciar.bat` (usam o mesmo navegador). Roteiro: [`docs/RECONHECIMENTO.md`](docs/RECONHECIMENTO.md).

## Configuração (`.env`)

Abra com `configurar.bat`. Principais itens (a lista completa, comentada, está em `.env.example`); não precisa reinstalar nem recompilar:

| Variável                                                          | Para quê                                                                                                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                                        | Endereço do sistema (obrigatório).                                                                                                                                   |
| `SITE_USUARIO`, `SITE_SENHA`, `LOGIN_AUTOMATICO`                  | Login automático (opcional).                                                                                                                                         |
| `SEND_MODE`                                                       | `observacao` (padrão: só mostra) ou `live` (envia de verdade).                                                                                                       |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`                            | Credenciais do Telegram (my.telegram.org).                                                                                                                           |
| `TELEGRAM_DESTINO`                                                | `me`, nome exato do canal/grupo (aceita chinês), `@usuario` ou ID.                                                                                                   |
| `TELEGRAM_DESTINO_5MIN`, `DURACAO_LONGA_MIN`                      | 2º grupo: ligações que chegam a N min (padrão 5) **ainda em Stage 1**. Vazio = desligado.                                                                            |
| `VALIDADE_MENSAGEM_MIN`                                           | Mensagem mais velha que isso não é enviada (padrão 15; 0 = nunca descarta).                                                                                          |
| `JANELA_TRANSFERENCIA_SEG`                                        | Tempo máximo entre o Stage 1 sumir e a linha de destino aparecer (padrão 60).                                                                                        |
| `TRANSFERENCIA_DESTINO_STAGE`                                     | Stage para onde vai a transferência que gera a mensagem: `2` (padrão, linha 1 → linha 2) ou `3` (fluxo antigo, linha 1 → Stage 3).                                   |
| `TRANSFERENCIA_DESTINO_DIGITO`                                    | Antepenúltimo dígito exigido no número de quem recebe (padrão `2` = `***2**`); `nenhum` = não confere. A mesma linha mudando de Stage 1 para o destino conta sempre. |
| `NOTIFICAR_WINDOWS`, `NOTIFICAR_TRANSFERENCIAS`, `NOTIFICAR_5MIN` | Notificações do Windows (padrão: ligadas; as de transferência/CALLBACK e as de 5 min, desligadas, cada uma no seu botão).                                            |
| `NAVEGADOR`                                                       | `msedge` (padrão) ou `chromium`.                                                                                                                                     |

Ao trocar a URL, o navegador pode pedir novo login.

## Notificações do Windows

O programa mostra uma **notificação do Windows** (canto da tela) quando algo relevante acontece, para você perceber mesmo sem olhar o console:

- **Erros** (sempre): envio que falhou, mensagem velha demais, envio incerto, cliente não encontrado ou telefone diferente, consulta que travou, sessão do site expirada, falha ao voltar para a Voice Call Status, erro inesperado ou programa parado.
- **Avisos relevantes:** login ou verificação (botão quadrado) esperando você, monitoramento retomado depois de uma pausa (transferências nesse intervalo não foram vistas), tabela ilegível, CALLBACK que não pôde ser enviado.
- Cada transferência detectada e CALLBACK **não** notificam por padrão (`NOTIFICAR_TRANSFERENCIAS=true` liga). Cada ligação de 5 min também não (`NOTIFICAR_5MIN=true` liga). Os dois são independentes. Erros sempre notificam enquanto `NOTIFICAR_WINDOWS=true`. A notificação e os avisos da tela sempre mostram o número do cliente e o Callback Number por inteiro; só os arquivos de log mascaram os telefones.
- Sem repetição: a mesma mensagem não volta em 2 minutos e há no máximo 4 por minuto (o resto vira "mais N avisos").
- As notificações não trazem dados de clientes (telefones saem mascarados).

Para conferir se o seu Windows mostra: abra **`testar-notificacao.bat`** (aparecem duas notificações de teste). Se não aparecerem: Configurações → Sistema → Notificações, deixe as notificações ligadas, desligue o "Não incomodar"/Assistente de foco e confira o item "Windows PowerShell". Para desligar de vez: `NOTIFICAR_WINDOWS=false`.

## Transferência ao tocar e CALLBACK

- **Fluxo atual (desde 21/10/2026): linha 1 → linha 2 → linha 3.** Tudo abaixo que fala em "Stage 3" vale agora para a **linha 2** (`Stage 2`, funcionário `***2**`). A linha 3 é ignorada: nada de mensagem nem aviso. Se a ligação passa da linha 2 para a linha 3, **nunca** é CALLBACK (nem se a linha 2 ficou menos de 20 s) e a duração registrada é só a da linha 2. Um `Stage 2` de funcionário que não é `***2**` não gera mensagem (só aviso).
- **Clicar na notificação abre o Telegram na mensagem:** com `NOTIFICAR_TRANSFERENCIAS=true` (ou `NOTIFICAR_5MIN=true` para o grupo de 5 min), quando uma mensagem chega ao grupo aparece uma notificação do Windows "Transferência enviada ao grupo… Clique para abrir no Telegram", sem som. Clicar nela (ou no botão "Abrir no Telegram") abre o Telegram Desktop direto naquela mensagem (endereço `tg://`). Funciona para **supergrupos e canais** (os grupos comuns do Telegram não têm link de mensagem: nesse caso não aparece essa notificação) e precisa do **Telegram Desktop instalado** no Windows. Vale também para o CALLBACK (abre a resposta).
- A mensagem de transferência sai **assim que o Stage 3 aparece tocando** (`Stage 3 Ringing`), sem esperar alguém atender. Se o Stage 3 já aparecer atendido (`Stage 3 Agent`), sai do mesmo jeito.
- Se alguém atende (aparece `Stage 3 Agent` para o mesmo cliente), **não sai mais nada**.
- Se o Stage 3 tocou e a ligação sumiu **sem ninguém atender**, o programa espera `CALLBACK_ESPERA_SEG` segundos (padrão 3, para o toque poder passar a outro agente) e **responde "CALLBACK"** à mensagem de transferência no mesmo grupo. Também é CALLBACK a ligação que **foi atendida mas ficou menos de `CALLBACK_LINHA2_SEG` segundos com a linha 2** (padrão 45; `0` desliga; desde 2026-10-30 o tempo é medido **pelo relógio do programa**, da primeira à última leitura com a linha 2 em "Agent", porque o "Call Duration" da tabela conta a ligação inteira, inclusive o tempo antes da transferência; a decisão sai quando a linha some da tabela). Só acontece se a mensagem de transferência foi enviada; se a original foi apagada, envia "CALLBACK" com o telefone e o Line 1 number.
- O CALLBACK também é registrado em `registros\transferencias-concluidas.txt`, marcado.

## Segundo grupo (ligações longas)

### Mensagem de 5 min repetida?

O mesmo cliente **não recebe de novo** a mensagem de 5 min dentro de `REPETICAO_5MIN_MIN` minutos (padrão 30; `0` desliga), mesmo que a ligação apareça como "nova" na tabela (outro Start Time, ligação que passa de um funcionário a outro) e **mesmo depois de reiniciar o programa**: ao iniciar, o programa lê `registros\ligacoes-5min.txt` e lembra de quem recebeu há pouco. No log aparece `longa_repetida`.

### Relatório por funcionário

Abra **`relatorio.bat`**: o navegador abre uma página com o relatório e os filtros **Hoje, Ontem, Esta semana, Últimos 7 dias, Este mês, Tudo** e **Escolher datas**. Mostra, por funcionário (Callback Number do Stage 1): transferências com callback (todas), sem callback (atendidas), callbacks (ninguém atendeu), % de callback e ligações de 5 min, mais a **duração média das transferências sem callback** (quanto tempo as ligações atendidas duraram, por funcionário), o total, a lista ligação a ligação e um botão **Baixar planilha (Excel)**: um arquivo `.xlsx` (abre no Excel, LibreOffice e Google Planilhas) com o mesmo período e filtros da tela, em abas formatadas — Resumo (indicadores e antes/depois do meio-dia), Por funcionário (com total, filtro e % já formatadas), Ligações (uma por linha, com cliente, resultado colorido, duração até a transferência e no Stage 3, observações), Ligações de 5 min, Meio-dia por funcionário e Por hora. Durações em h:mm:ss e datas reais (dá para somar, filtrar e ordenar no Excel). O arquivo fica em `registros\relatorios\relatorio.html`. A **duração média** é a de quanto a ligação **já durava quando foi transferida** para o Stage 3 (o "Call Duration" da última leitura da linha do Stage 1/Manual Call, antes de ela sumir), não o tempo da conversa no Stage 3. Cada ligação atendida é gravada em `registros\duracoes.txt` com a duração no Stage 3 (usada nas regras de callback por ligação curta e de religação) e, a partir desta versão, o campo `Até a transferência` (o que entra na média). **Registros anteriores a esta versão não têm esse campo e ficam fora da média.** A coluna da lista passou a se chamar "Duração até a transferência". **Só a última transferência do cliente no dia conta (desde 2026-10-30):** se o **mesmo cliente** (telefone; ignora zero à esquerda, DDI e DDD digitados a mais) foi transferido mais de uma vez no mesmo dia, por qualquer funcionário, o relatório conta **só a última**, no funcionário dela; as anteriores aparecem riscadas na lista ("Callback removido" se tinham dado callback, "Desconsiderada" se não) e não entram em nenhuma conta. A última vale pelo que aconteceu com ela: callback se deu callback, senão transferência concluída — então callback seguido de nova transferência = 1 transferência concluída, duas transferências sem callback = só a última, e transferência concluída seguida de callback = 1 callback. Vale **só no relatório** (o Telegram não muda); não depende da duração da nova transferência; prévias do modo observação não se misturam com as enviadas. `CALLBACK_RELIGACAO_MIN=0` desliga a regra (qualquer outro valor liga; o número em si não importa).

**Corrigir uma ligação:** na lista "Ligações do período", o botão **Marcar como callback** (em cada ligação atendida) abre uma janela de confirmação; ao confirmar, o relatório passa a contar aquela transferência como callback (sai da duração média). Vale **só para o relatório**: nada é enviado ao Telegram. A marcação fica gravada em `registros\callbacks-manuais.txt` e aparece como "(marcado no relatório)"; o botão **Desfazer** volta atrás. Para isso, **deixe a janela preta do `relatorio.bat` aberta** enquanto usa a página (é ela que grava); se a aba for fechada, o endereço para reabrir aparece nessa janela. **Atualização automática:** enquanto a janela do `relatorio.bat` estiver aberta, a página busca os registros de novo a cada 10 segundos e redesenha tabelas e totais sem recarregar (mantém filtro e rolagem); mostra "Atualizado às HH:MM:SS", tem o botão **Pausar atualização**, não atualiza com a janela de confirmação aberta nem com a aba escondida, e avisa "Sem conexão com o relatório" (mantendo a tabela) se a janela do `.bat` for fechada. O arquivo `relatorio.html` aberto direto (sem o `.bat`) só mostra, sem os botões e sem atualizar. O relatório é calculado a partir dos `.txt` de registro: cada ligação recebe um código no cabeçalho do registro, e o CALLBACK é ligado à transferência da MESMA ligação por esse código (registros antigos, sem código, são ligados por proximidade e funcionário).

**Apelidos e meio-dia no relatório.** Todos os funcionários são seus: todas as transferências geram mensagem e entram no relatório. `APELIDOS_FUNCIONARIOS=908113=Maria; 908114=João` mostra **sempre nome e número juntos** ("Maria (908113)"; sem apelido: "908113 (sem apelido)"), no relatório e nos avisos do Windows/console. A tabela "Ligações de 5 minutos: viraram transferência?" mostra, por funcionário, quantas ligações de 5 min foram transferidas e quantas não (e as %). A seção "Antes e depois do meio-dia (horário de Brasília)" compara ligações de 5 min, transferências, callbacks, taxas e duração, com gráfico por hora e quadro por funcionário.

## Modelo da mensagem

Edite `config\mensagem.txt` (também pelo `configurar.bat`). Marcadores obrigatórios, exatamente assim: `{{nome}}`, `{{cpf}}`, `{{location}}`,
`{{age}}`, `{{Phone}}` e `{{callback number}}`. Se faltar algum ou houver um desconhecido, o programa avisa ao iniciar e não começa.
Campos que não existirem no cadastro ficam vazios. `Line 1 number` é o Callback Number **antigo** (o do Stage 1).

## Telegram (conta pessoal)

1. Em https://my.telegram.org → "API development tools", crie o app e copie `api_id` e `api_hash` para o `.env`. Trate o `api_hash` como senha.
2. `telegram.bat` → **1 (login)**: telefone, código e (se tiver) senha 2FA, digitados no console. Só a sessão é salva (`%LOCALAPPDATA%\TransferBot\telegram\sessao.txt`), **cifrada com a senha de liberação** (AES-256-GCM, chave derivada por scrypt; o comando pede a senha). Sem a senha, o arquivo não abre. Uma sessão antiga em texto simples é cifrada sozinha na primeira vez que o envio real inicia. Se esquecer/trocar a senha, refaça o login com `telegram.bat`.
3. `telegram.bat` → **2 (chats)** mostra os IDs; ponha o nome exato do canal ou o ID em `TELEGRAM_DESTINO`.
4. `telegram.bat` → **3 (teste)** envia uma mensagem de teste (sem dados de cliente).
5. Roteiro recomendado: modo observação → `SEND_MODE=live` com `TELEGRAM_DESTINO=me` → canal definitivo. Com `live`, o programa pede a **senha de liberação** a cada inicialização (digitada sem aparecer na tela, 3 tentativas). A senha é fixa e não é configurável; o código guarda só um resumo irreversível dela (scrypt), não a senha.

## Segurança e privacidade

- Senhas e `api_hash` ficam só no `.env` (ignorado pelo git). **Não compartilhe** esse arquivo nem o coloque em pastas sincronizadas (OneDrive etc.).
- Se o endereço começa com `http://` (sem `s`), usuário e senha trafegam **sem criptografia** na rede. Prefira `https://` se existir.
- Logs em `%LOCALAPPDATA%\TransferBot\logs`: telefones mascarados e **nenhum** dado de cliente (nome, CPF, localização, idade).
- O programa só **lê** o site: bloqueia qualquer requisição de escrita/exclusão do cadastro e nunca clica em salvar, atualizar ou excluir.
- Exceto pelos registros abaixo, não há histórico em arquivo ou banco: o estado fica na memória e o Telegram é o histórico.
- **Registros das mensagens:** a pasta `registros\` (ao lado do programa) recebe `transferencias-concluidas.txt` e `ligacoes-5min.txt`, com o texto de cada mensagem enviada (em modo observação, marcada como "não enviada"). **Esses arquivos contêm dados de clientes**: não os compartilhe nem os envie ao git (a pasta já é ignorada). Mude a pasta com `PASTA_REGISTROS` ou desligue com `REGISTRAR_MENSAGENS=false`. Os arquivos só crescem; apague ou arquive de tempos em tempos.
- A verificação do botão quadrado e qualquer 2FA são sempre feitos por você.

## Mensagem em dobro?

O programa tem três travas contra duplicata: (1) só uma cópia pode ficar aberta (arquivo `bot.lock` na pasta de dados; se abrir outra, ele avisa e não inicia); (2) o mesmo texto não é reenviado ao mesmo grupo em 60 s; (3) quando um envio dá timeout, ele confere o grupo antes de reenviar (tolerando diferença de relógio entre o PC e o Telegram). Para investigar, procure no log do dia por `envio_tentativa` (cada tentativa, com o id da tarefa) e `reenvio_apos_verificacao`. Duas linhas `envio_tentativa` com o mesmo `idCurto` mostram um reenvio automático.

## Solução de problemas

| Problema                             | O que fazer                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Não sei o que está errado            | Abra `diagnostico.bat`: ele lista cada item com [OK], [AVISO] ou [ERRO] e o que fazer.                |
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
