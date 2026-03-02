import nodemailer from "nodemailer";
import { logger } from "./logger.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn(
      "SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required). " +
        "Password reset emails will be logged to console instead."
    );
    // Return a JSON transport that logs to console for dev/testing
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export async function sendPasswordResetEmail(
  toEmail: string,
  temporaryPassword: string
): Promise<void> {
  const transport = getTransporter();
  const from = process.env.SMTP_FROM || "noreply@vibechat.app";

  const mailOptions = {
    from,
    to: toEmail,
    subject: "Vibe Chat - Password Reset",
    text: [
      "You requested a password reset for your Vibe Chat account.",
      "",
      `Your temporary password is: ${temporaryPassword}`,
      "",
      "This temporary password expires in 15 minutes.",
      "Use it on the reset password page to set a new password.",
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #5865F2;">Vibe Chat - Password Reset</h2>
        <p>You requested a password reset for your Vibe Chat account.</p>
        <p>Your temporary password is:</p>
        <div style="background: #f0f0f0; padding: 12px 16px; border-radius: 8px; font-size: 20px; font-family: monospace; letter-spacing: 2px; text-align: center; margin: 16px 0;">
          ${temporaryPassword}
        </div>
        <p style="color: #666; font-size: 14px;">This temporary password expires in <strong>15 minutes</strong>.</p>
        <p>Use it on the reset password page to set a new password.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };

  const info = await transport.sendMail(mailOptions);

  // If using JSON transport (no SMTP configured), log the temp password
  if (!process.env.SMTP_HOST) {
    logger.info(
      `[DEV] Password reset email for ${toEmail} — temporary password: ${temporaryPassword}`
    );
    logger.info(`[DEV] Full email payload: ${info.message}`);
  }
}
