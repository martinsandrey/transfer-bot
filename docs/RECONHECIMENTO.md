# Roteiro de reconhecimento (para você rodar no Windows)

**Objetivo:** coletar a estrutura do site (colunas, DOM, status, formato de dados, login, abas) **sem expor dados de clientes**.
Isto será feito com a ferramenta `npm run recon`, criada na **Fase 2**. Este documento define o que será coletado e como
você deve revisar e enviar. Enquanto a ferramenta não existe, **não envie nada**.

## Princípios

1. A ferramenta só **lê** (não clica em salvar, não faz requisições próprias, não contorna login). Você faz o login manualmente.
2. Todo valor pessoal é substituído por marcador **na própria ferramenta**, mas **você revisa antes de enviar**.
3. A saída fica numa pasta local ignorada pelo git (`saida-reconhecimento/`). Nada é commitado automaticamente.
4. Não envie senhas, cookies, tokens, `localStorage`, HAR, capturas de tela com nomes/CPFs.

## O que será capturado

**Tela de login (sem logar):** estrutura do formulário (tipos/nomes/rótulos dos campos e do botão), presença de captcha/2FA
(só "existe/não existe"), título da página, rótulos visíveis. Nenhum valor digitado.

**Tabela de chamadas (após login manual):**

- cabeçalhos de colunas (texto) e ordem; estrutura do DOM (tags, papéis ARIA, `id`, `name`, `data-*`, classes — **sem texto das células**);
- se há paginação/filtro/rolagem virtual; como a tabela aparece vazia ou "atualizando";
- **valores distintos de `Call Status`** (esses valores não são pessoais);
- formato de cada coluna descrito por tipo/padrão, não pelo valor: ex. `Start Time` → `AAAA-MM-DD HH:mm:ss` ou similar;
  telefones → `+<DDI><dígitos>` / `(##) #####-####` etc. (marcadores como `<TEL:11 dígitos>`);
- **sequência de snapshots ao longo do tempo** (ex.: 60 snapshots, 1 por segundo) com callback/callee substituídos por
  marcadores estáveis (`FUNC_01`, `CLIENTE_07`) — permite ver reordenação, linhas que somem e qual campo distingue ligações sucessivas;
- URLs **relativas** e **forma** (apenas chaves e tipos) das requisições que alimentam a tabela (XHR/fetch/WebSocket), sem
  valores, cabeçalhos de autenticação nem cookies.

**Menu e Customer Data List:** textos do menu lateral, rótulos do formulário de busca (Phone, Search), estrutura da tabela de
resultados (cabeçalhos), tela com 0/1/N resultados (sem valores), rótulos/`name`/`id` dos campos do formulário de edição
(nome, cpf, location, age, phone) **sem os valores**, e nomes dos botões de ação da tela de edição (para nunca clicá-los).

**Testes de abas e segundo plano (você executa, descreve o resultado):**

1. Abrir a Customer Data List em uma segunda aba: a tabela da primeira continua atualizando? A sessão cai?
2. Deixar a janela do navegador minimizada/coberta por 2 min: a tabela continua se atualizando ao voltar?
3. Quanto tempo a sessão dura? O que aparece quando expira?

## Como revisar e anonimizar (antes de enviar)

1. Abra `saida-reconhecimento\` e procure por: telefones, CPFs, nomes, e-mails, cidades, idades, tokens (`Bearer`, `session`), URLs com
   IDs de cliente. Use a busca do Bloco de Notas por `+55`, dígitos longos, `@`, `token`, `cookie`.
2. Qualquer coisa suspeita: substitua por um marcador (`<REMOVIDO>`) ou apague o trecho.
3. A ferramenta gera `LEIAME-REVISAO.txt` com a lista do que foi trocado por marcador (contagens, não valores).
4. Se algum dado pessoal real aparecer, **não envie** e me avise; eu ajusto a ferramenta.
5. Prefira **HTML salvo** apenas da estrutura (a ferramenta já gera "esqueleto" sem textos de células). Não use "Salvar página como" no
   navegador: ele inclui dados reais.

## Como enviar

- Compacte `saida-reconhecimento\` revisada e **anexe na conversa** (preferido, não entra no histórico do git) **ou**
  copie os arquivos revisados para `docs/evidencias/` no repositório e faça commit **somente depois** de revisar tudo.
- Informe no mesmo envio: versão do Windows/navegador, fuso horário do computador, resposta aos 3 testes de abas/segundo plano
  e se houve captcha/2FA no login.

## O que você precisa fazer no Windows (resumo, na Fase 2)

1. Instalar Node 24 LTS (se ainda não tiver) e baixar o projeto. 2. `npm ci`. 3. Copiar `.env.example` para `.env` e preencher a URL
   (usuário/senha opcionais). 4. `npm run recon` e logar manualmente quando pedido. 5. Revisar a saída (acima). 6. Enviar.
