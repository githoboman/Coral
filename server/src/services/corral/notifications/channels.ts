/**
 * Channel adapters over the inherited email and Telegram services.
 *
 * Imported **lazily**, inside the delivery call. The inherited services build
 * clients and read configuration at module load; a static import here would
 * make every Corral module that transitively touches notifications refuse to
 * boot without an SMTP host. That is the same coupling the standalone router
 * test exists to prevent (§8.4), and the fix is the same: do not load them
 * until something actually needs to send.
 *
 * Both adapters swallow their own errors and report a boolean, because the
 * dispatcher treats delivery as fallible by design (FR-10.5).
 */
import { renderText, type Channels, type Deliver } from "./dispatch.js";

const email: Deliver = async (m) => {
  try {
    const { getEmailService } = await import("../../emailService.js");
    const html = [
      `<p>${escapeHtml(m.body).replace(/\n/g, "<br>")}</p>`,
      m.link ? `<p><a href="${escapeHtml(m.link)}">Open in Corral</a></p>` : "",
      m.actionRequired ? `<p><strong>This one needs you to take a look.</strong></p>` : "",
    ].join("");
    return await getEmailService().sendEmail(m.to, m.subject, html, renderText({
      subject: m.subject,
      body: m.body,
      link: m.link,
      action_required: m.actionRequired,
    }));
  } catch {
    return false;
  }
};

const telegram: Deliver = async (m) => {
  try {
    const { getTelegramService } = await import("../../telegramService.js");
    const service = getTelegramService() as unknown as {
      sendMessage?: (chatId: string, text: string) => Promise<unknown>;
    };
    if (typeof service.sendMessage !== "function") return false;
    await service.sendMessage(
      m.to,
      renderText({ subject: m.subject, body: m.body, link: m.link, action_required: m.actionRequired }),
    );
    return true;
  } catch {
    return false;
  }
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The channels a normal deployment uses. Tests inject their own. */
export function defaultChannels(): Channels {
  return { EMAIL: email, TELEGRAM: telegram };
}
