// Email delivery boundary for sign-in links and invitations.
//
// EMAIL_PROVIDER selects the transport:
// - "cloudflare": sends through the EMAIL binding from EMAIL_FROM (an onboarded sending domain).
// - "smtp": the Node server (server/node.mjs) sends through SMTP_MAILER, an SMTP transport with the
//   same send(message) shape as the EMAIL binding, from EMAIL_FROM.
// - "outbox": development/test only. Messages are stored in the account directory and can be
//   read back through GET /api/dev/outbox?to=<email>. Never enable this on a public deployment.
// - "webhook": POSTs {to,subject,text} JSON to EMAIL_WEBHOOK_URL with a bearer EMAIL_WEBHOOK_TOKEN,
//   for a transactional email relay you operate. Requires live credentials (not exercised locally).
// Anything else disables email sign-in with a 503.
import { rpcFail } from "./http.js";

export async function sendMail(env, directory, message) {
  const provider = env.EMAIL_PROVIDER || "disabled";
  if (provider === "outbox") {
    await directory.storeOutbox(message);
    return { provider };
  }
  if (provider === "webhook") {
    if (!env.EMAIL_WEBHOOK_URL || !env.EMAIL_WEBHOOK_TOKEN)
      rpcFail(503, "Email delivery is not configured on this server");
    const response = await fetch(env.EMAIL_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.EMAIL_WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) rpcFail(502, "Email delivery failed; try again later");
    return { provider };
  }
  // A Mailer: {send({from: {email, name}, to, subject, text, html})} (cloud/platform/README.md).
  const mailer = { cloudflare: env.EMAIL, smtp: env.SMTP_MAILER }[provider];
  if (provider === "cloudflare" || provider === "smtp") {
    if (!mailer || !env.EMAIL_FROM) rpcFail(503, "Email delivery is not configured on this server");
    const html = message.text.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );
    try {
      await mailer.send({
        from: { email: env.EMAIL_FROM, name: "Verynize" },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: `<pre>${html}</pre>`,
      });
    } catch {
      rpcFail(502, "Email delivery failed; try again later");
    }
    return { provider };
  }
  rpcFail(503, "Email sign-in is not enabled on this server");
}
