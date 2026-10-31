// Email on Node: an SMTP Mailer with the `send(message)` shape of Cloudflare's send-email binding
// (cloud/mail.js, EMAIL_PROVIDER=smtp). Credentials come from the environment and are never logged.
export function createSmtpMailer({ host, port, secure, user, pass, requireTls }) {
  if (!host) throw new Error("SMTP_HOST is required for EMAIL_PROVIDER=smtp");
  let transport;
  const connect = async () => {
    const { default: nodemailer } = await import("nodemailer");
    return nodemailer.createTransport({
      host,
      port: port ? Number(port) : secure ? 465 : 587,
      secure: !!secure,
      requireTLS: !!requireTls,
      auth: user ? { user, pass } : undefined,
    });
  };
  return {
    async send({ from, to, subject, text, html }) {
      transport ||= connect().catch((error) => {
        transport = null;
        throw error;
      });
      await (
        await transport
      ).sendMail({
        from: typeof from === "string" ? from : { name: from.name || "", address: from.email },
        to,
        subject,
        text,
        html,
      });
    },
  };
}
