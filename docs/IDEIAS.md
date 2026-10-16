# Ideias de automação, organização e robustez (2026-10-17)

Lista viva, em ordem de recomendação dentro de cada grupo. Nada daqui está implementado, salvo o que a seção "Já feito" diz.

## Já feito nesta rodada de robustez

- Reenvio automático quando o programa **confere o grupo e a mensagem não chegou** (até `maxTentativasEnvio`); se não deu para conferir (sem rede), confere de novo algumas vezes antes de marcar "incerta".
- O laço do monitor **nunca morre** por erro inesperado (registra, avisa sem spam e segue); promessas rejeitadas esquecidas não derrubam o programa.
- Telegram: reconecta antes de enviar/conferir se a conexão caiu; mais tentativas de reconexão.
- Testes novos: fuzz do rastreador (200 sementes × 900 s), caos na fila + Telegram (120 sementes), falhas do site na consulta ao cadastro, resiliência do monitor, mensagens com dados estranhos.

## Para não perder mensagem nem depender de "estar na tela da tabela"

1. **Avisos para você no Telegram** (em "me" ou num grupo de avisos): sessão expirou, tabela sem leitura há X min, mensagem não enviada, Telegram sem conexão. Resolve o caso de você não estar olhando o console.
2. **Segunda aba só para as consultas (experimental, ligável por opção).** A aba da tabela nunca sai da tela, então acabam as pausas de leitura. Riscos a testar no site real: o site aceitar duas abas na mesma sessão e a aba em segundo plano ficar lenta.
3. **Pré-checagem antes de cada consulta** ("estou na página certa? o menu aparece?") com autocorreção (recarregar `index.php`, refazer o login) e uma nova tentativa antes de desistir.
4. **Autorrecuperação da tabela:** se a tabela some por poucas leituras, clicar em "Voice Call Status" sozinho antes de declarar a sessão expirada (hoje só depois).
5. **Vigia de tabela parada:** alerta se nada muda na tabela por X minutos em horário de trabalho (pode ser travamento da página).
6. **Impedir o Windows de dormir** e reiniciar o programa sozinho se ele cair (`iniciar.bat` em laço). PC suspenso ou tela bloqueada derruba o monitoramento sem aviso.
7. **Grupo de reserva:** se o envio ao grupo principal falhar por permissão/destino, enviar ao grupo de reserva (`TELEGRAM_DESTINO_RESERVA`) com aviso.
8. **Autoteste ao iniciar** com ✔/✖: Node, `.env`, Telegram, grupos resolvidos, login, tabela legível, menu da Customer Data List encontrado, modelo de mensagem válido.
9. **Comandos no console:** `status` completo (fila, pendências, última leitura há X s), `reenviar tN`, `pausar`/`retomar` envios mantendo a detecção.

## Organização e automação

10. **Registros por dia ou mês** (um arquivo por período) com limpeza/rotação automática, e um CSV de resumo.
11. **Resumo diário** (no Telegram para você): quantas transferências, CALLBACKs, ligações de 5 min, falhas.
12. **Horário de funcionamento:** pausar sozinho fora do expediente, sem fechar o programa.
13. **Modo ensaio (replay):** gravar as leituras da tabela (sem telefones reais) e reproduzi-las para testar mudanças com dados de verdade.
14. **Painel local simples** (página em `localhost`) com a fila, o estado e as últimas mensagens.
15. **Verificação de versão nova** ao iniciar (avisa que há atualização; o `atualizar.bat` aplica).
