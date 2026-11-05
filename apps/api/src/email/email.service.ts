import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email through SMTP when SMTP_URL is set (for example
 * smtps://user:pass@smtp.example.com). Without it, development prints the
 * message to the server console so flows like password reset can be tried
 * locally. In production an unconfigured server never prints message bodies,
 * because they contain one-time links.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SMTP_URL')?.trim();
    this.transport = url ? nodemailer.createTransport(url) : null;
    this.from =
      this.config.get<string>('EMAIL_FROM')?.trim() ||
      'DevFlow <no-reply@devflow.local>';
  }

  /** True when mail really leaves the server (not just logged). */
  get delivers() {
    return this.transport !== null;
  }

  get webUrl() {
    return (
      this.config.get<string>('WEB_URL')?.trim() ||
      this.config.get<string>('WEB_ORIGIN')?.trim() ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  /** Never throws: callers must not fail (or leak) because mail failed. */
  async send(email: Email): Promise<boolean> {
    try {
      if (this.transport) {
        await this.transport.sendMail({ from: this.from, ...email });
        return true;
      }
      if (this.config.get('NODE_ENV') === 'production') {
        this.log.warn(`SMTP_URL is not set; email to ${email.to} was not sent`);
        return false;
      }
      this.log.log(
        `[dev email] to=${email.to} subject="${email.subject}"\n${email.text}`,
      );
      return false;
    } catch (err) {
      this.log.error(
        `Failed to send email to ${email.to}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
