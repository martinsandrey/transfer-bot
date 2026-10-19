import { spawn } from "node:child_process";
import { mascararTexto } from "../util/mascara.js";

type Spawn = typeof spawn;

/**
 * Notificações do Windows (toast) sem dependências: um PowerShell curto, com o texto passado em base64 (sem problema de aspas ou de
 * caracteres especiais/chinês). Tenta o toast moderno (centro de notificações); se falhar, usa o balão da bandeja.
 * Regras: nunca lança erro; texto passa pelo mascaramento (CPF, e-mail e, salvo `mascararTelefones: false`, telefones); repetições iguais são suprimidas; no máximo
 * `limitePorMinuto` por minuto (o excedente vira UM aviso "mais N avisos").
 */
export interface OpcoesToast {
  plataforma?: NodeJS.Platform;
  spawnFn?: Spawn;
  agora?: () => number;
  /** Agenda uma função (padrão: setTimeout sem segurar o processo). Injetável em testes. */
  agendar?: (fn: () => void, ms: number) => void;
  /** Mesma mensagem dentro desta janela é ignorada (padrão 2 min). */
  janelaRepeticaoMs?: number;
  /** Máximo de notificações por minuto (padrão 4). */
  limitePorMinuto?: number;
  /** `false` = mostra os telefones por inteiro na notificação (CPF e e-mail continuam mascarados). Padrão: true. */
  mascararTelefones?: boolean;
}

export type Toast = (titulo: string, texto: string) => void;

/** AppUserModelId do próprio Windows PowerShell: já é registrado no Windows, então o toast aparece sem instalar nada. */
const APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

/** Script do PowerShell (exportado para teste). Título e texto entram só como base64. */
export function scriptDoToast(titulo: string, texto: string): string {
  return `$ErrorActionPreference = 'Stop'
$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(titulo)}'))
$m = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(texto)}'))
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml('<toast scenario="reminder"><visual><binding template="ToastGeneric"><text>' + [Security.SecurityElement]::Escape($t) + '</text><text>' + [Security.SecurityElement]::Escape($m) + '</text></binding></visual></toast>')
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show($toast)
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $n = New-Object System.Windows.Forms.NotifyIcon
  $n.Icon = [System.Drawing.SystemIcons]::Warning
  $n.Visible = $true
  $n.ShowBalloonTip(15000, $t, $m, [System.Windows.Forms.ToolTipIcon]::Warning)
  Start-Sleep -Seconds 16
  $n.Dispose()
}
`;
}

export function criarToastWindows(op: OpcoesToast = {}): Toast {
  const plataforma = op.plataforma ?? process.platform;
  const spawnFn = op.spawnFn ?? spawn;
  const agora = op.agora ?? Date.now;
  const agendar =
    op.agendar ??
    ((fn: () => void, ms: number): void => {
      setTimeout(fn, ms).unref();
    });
  const janelaRepeticao = op.janelaRepeticaoMs ?? 120_000;
  const limite = op.limitePorMinuto ?? 4;

  const recentes = new Map<string, number>();
  let enviadas: number[] = [];
  let suprimidas = 0;
  let flushAgendado = false;

  const disparar = (titulo: string, texto: string): void => {
    try {
      const comando = Buffer.from(scriptDoToast(titulo, texto), "utf16le").toString("base64");
      const filho = spawnFn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", comando],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      filho.on("error", () => undefined);
      filho.unref();
    } catch {
      /* notificação é só um aviso extra: nunca derruba o programa */
    }
  };

  const tentar = (titulo: string, texto: string, contaNaJanela = true): void => {
    const t = agora();
    enviadas = enviadas.filter((x) => t - x < 60_000);
    if (contaNaJanela && enviadas.length >= limite) {
      suprimidas++;
      if (!flushAgendado) {
        flushAgendado = true;
        agendar(() => {
          flushAgendado = false;
          const n = suprimidas;
          suprimidas = 0;
          if (n > 0)
            tentar(
              "Transfer Bot",
              `Mais ${n} aviso${n > 1 ? "s" : ""} (veja a janela do programa).`,
              false,
            );
        }, 61_000);
      }
      return;
    }
    enviadas.push(t);
    disparar(titulo, texto);
  };

  return (titulo, texto) => {
    if (plataforma !== "win32") return;
    const limpo = mascararTexto(texto, { telefones: op.mascararTelefones !== false })
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    if (limpo === "") return;
    const t = agora();
    for (const [k, quando] of recentes) if (t - quando > janelaRepeticao) recentes.delete(k);
    if (recentes.has(limpo)) return; // mesma mensagem há pouco: não repete
    recentes.set(limpo, t);
    tentar(titulo, limpo);
  };
}
