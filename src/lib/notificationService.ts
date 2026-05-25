type EmailPayload = {
  to: string;
  subject: string;
  content: string;
};

export async function sendEmailNotification(payload: EmailPayload) {
  const to = payload.to.trim();
  if (!to) return;

  const webhookUrl = process.env.NOTIFY_EMAIL_WEBHOOK_URL?.trim() || "";
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: payload.subject,
          content: payload.content,
        }),
      });
      return;
    } catch {
      // Fallback to log mode below
    }
  }

  if (process.env.DEBUG_LOG_NOTIFICATIONS !== "false") {
    console.log("[EMAIL-NOTIFY]", {
      to,
      subject: payload.subject,
      content: payload.content,
    });
  }
}
