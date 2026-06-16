import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const defaultFromEmail = process.env.FROM_EMAIL || 'hrms-x@kumutech.com.ng';

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
