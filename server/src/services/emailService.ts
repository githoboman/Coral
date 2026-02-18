import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

export class EmailService {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter;

  private constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hostinger.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  public async sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.warn('[EMAIL] Credentials missing, skipping email.');
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"Tovira" <${process.env.EMAIL_USER}>`, // sender address
        to, // list of receivers
        subject, // Subject line
        text: text || html.replace(/<[^>]*>?/gm, ''), // plain text body
        html, // html body
      });

      console.log(`[EMAIL] Message sent: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error('[EMAIL] Error sending email:', error);
      return false;
    }
  }
}

export const getEmailService = () => EmailService.getInstance();
