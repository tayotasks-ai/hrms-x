import { Resend } from 'resend';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve .env by an absolute path instead of relying on process.cwd().
// Why: this file constructs the Resend client at module-load time (below),
// and ES module imports are hoisted — meaning this whole module (and its
// `new Resend(...)` call) executes BEFORE server.js's own `dotenv.config()`
// line ever runs, regardless of where that line appears in server.js. If
// this file's own dotenv.config() call resolved .env relative to cwd, it
// would silently find nothing (and RESEND_API_KEY would stay undefined)
// whenever the process is launched from a directory other than backend/ —
// exactly what caused "Missing API key" crashes even with a valid .env
// sitting right next to server.js. An absolute path removes the cwd
// dependency entirely.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const resend = new Resend(process.env.RESEND_API_KEY);

// Keep whatever address is actually verified with Resend (changing it here
// would risk breaking deliverability without a matching domain/DNS change),
// but always show "WorkDesk" as the display name in the recipient's inbox
// rather than the old "HRMS X" branding or a bare address.
const rawFromEmail = process.env.FROM_EMAIL || 'hrms-x@kumutech.com.ng';
const bareFromAddress = (rawFromEmail.match(/<(.+)>/) || [, rawFromEmail])[1];
const defaultFromEmail = `WorkDesk <${bareFromAddress}>`;

/**
 * Send an email using Resend
 * 
 * @param {Object} options Email options
 * @param {string|string[]} options.to Recipient email address(es)
 * @param {string} options.subject Email subject
 * @param {string} options.html HTML content of the email
 * @param {string} [options.text] Plain text content (optional)
 * @param {string} [options.from] Sender email address (defaults to FROM_EMAIL in env)
 * @returns {Promise<Object>} Resend API response
 */
export const sendEmail = async ({ to, subject, html, text, from }) => {
  try {
    const { data, error } = await resend.emails.send({
      from: from || defaultFromEmail,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      console.error('Error sending email via Resend:', error);
      throw new Error(error.message);
    }

    return { success: true, data };
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
};
