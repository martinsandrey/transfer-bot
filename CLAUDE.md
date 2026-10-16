# CLAUDE.md — Transfer Bot

Memória do projeto para sessões do Claude Code (cada sessão na nuvem começa do zero). Leia também
`docs/PROGRESSO.md` (onde estamos) e `docs/PERGUNTAS_ABERTAS.md` (o que depende do usuário).
O prompt original está em `docs/prompt-inicial.md`. **Idioma: português do Brasil** (docs, mensagens ao usuário, commits).

## O que é

Programa para **Windows 10/11** (executado pelo usuário, localmente) que abre um navegador dedicado (Playwright),
monitora a tabela de chamadas de um website, detecta transferências (`Stage 1 Agent` → `Stage 3 Agent`),
consulta o cliente na Customer Data List (somente leitura), monta uma mensagem a partir de `config/mensagem.txt`
e a entrega a um `MessageSender` (Telegram — **forma ainda não decidida**; hoje só console/simulação).
Desenvolvimento na nuvem (Linux), sem acesso ao site real: tudo é testado com simulações.

## Fases (uma por vez; só avançar com aprovação explícita do usuário)

1 Investigação/arquitetura (**feita**; Fase 2 em andamento — ver PROGRESSO) · 2 Navegador/login/leitura · 3 Monitoramento e fila (simulado) ·
4 Customer Data List + mensagem · 5 Telegram · 6 Integração e E2E · 7 Instalação Windows. Detalhes: `docs/PLANO_DE_FASES.md`.
Ao fim de cada fase: testes verdes, commit, push no branch da sessão, atualizar `docs/PROGRESSO.md`, relatório curto, **parar**.

## Comandos

```
npm ci               # instalar (lockfile commitado)
npm run lint         # eslint
npm run typecheck    # tsc --noEmit (strict)
npm test             # vitest run
npm run format       # prettier --write (format:check no CI)
npm run build        # tsc -p tsconfig.build.json
npm run simular      # cenário fictício completo (sem site, sem navegador)
npm start            # modo real (hoje: só detecta transferências)
npm run recon        # (Fase 2) ferramenta de reconhecimento: rodar no Windows, ver docs/RECONHECIMENTO.md
```

Node: engines `>=22.13` (alvo no Windows: Node 24 LTS). TypeScript fixado em **6.0.x** (typescript-eslint ainda não aceita o TS 7; ver DECISOES).

## Regras invioláveis (resumo do prompt)

1. **Nada inventado sobre o site**: seletores, URLs internas, endpoints, nomes de colunas além dos informados, formatos de
   data, valores de status e navegação só entram no código com **evidência fornecida pelo usuário** (recon, capturas anonimizadas, HTML).
   Até lá: interfaces, configuração e fixtures fictícios; suposições = `TODO(confirmar)` + entrada em `docs/PERGUNTAS_ABERTAS.md`.
2. **Somente leitura no site**: nunca clicar em Salvar/Save/Update/Delete ou equivalentes; nunca alterar cadastro.
3. **Sem segurança burlada**: não contornar captcha/2FA/limites. Login automático = só preencher o formulário, **uma tentativa**;
   captcha/falha → pausa, som e espera login manual. Sem loops de tentativa.
4. **Sem persistência de transferências**: proibido SQLite/JSON de histórico. Estado só em memória; o Telegram é o histórico.
   Persistência local permitida: sessão (perfil do navegador, sessão do Telegram) e configuração.
5. **Segredos/PII**: nada de senha, token, api_hash, telefone ou dados de cliente no código, testes, commits ou logs.
   `.env` ignorado pelo git; `.env.example` só com placeholders. Códigos 2FA/Telegram digitados no console, nunca gravados.
   Sessões/perfis fora do repositório. Logs mascaram telefone (`***1234`) e CPF e **nunca** registram nome, CPF, localização, idade.
6. **Tudo configurável sem recompilar** (URL, usuário, senha, intervalos, modo), validado na inicialização, erros em português.
7. **Modo observação é o padrão**; envio real só com `SEND_MODE=live` **e** confirmação digitada a cada inicialização.
8. **Identidade da chamada** = Callback Number + algo que distinga ligações sucessivas (a confirmar na Fase 2). Dedup por
   _ocorrência_, nunca só por Callback Number. Posição da linha nunca é identidade.
9. **Funciona no Windows** (caminhos, encoding UTF-8, `.bat` em CRLF) e é testável no Linux.
10. Esperas por condição, nunca `sleep` fixo como mecanismo principal. Seletores estáveis (id, name, data-*, ARIA, texto).

## Fluxo de git

O usuário autorizou (2026-10-16, de forma permanente) o **push direto na `main`**, sem PR e sem pedir confirmação a cada vez.
Fazer commit, rodar lint/typecheck/testes antes, e enviar com `git push origin HEAD:main` (fast-forward; se a `main` tiver divergido, fazer merge dela antes). Manter também o branch da sessão em dia.

## Convenções

TypeScript strict, ESM, imports com extensão `.js`. Testes em `tests/` (vitest). Poucas dependências, versões **exatas** (`.npmrc save-exact`).
Verificar a versão atual de qualquer biblioteca antes de adicioná-la (`npm view`). Dependências de runtime só entram na fase que as usa.
Documentação viva: `docs/ARQUITETURA.md`, `DECISOES.md`, `RISCOS.md`, `PERGUNTAS_ABERTAS.md`, `PLANO_DE_FASES.md`, `RECONHECIMENTO.md`, `PROGRESSO.md`.
