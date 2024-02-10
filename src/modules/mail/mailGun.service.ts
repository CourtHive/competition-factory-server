import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

@Injectable()
export class MailgunService {
  constructor(private readonly config: ConfigService) {}
  private domain = this.config.get('mail')?.domain || process.env.MAILGUN_DOMAIN;
  private key = this.config.get('mail')?.key || process.env.MAILGUN_API_KEY;

  private client = new Mailgun(FormData).client({
    username: 'api',
    key: this.key,
  });

  async sendMail(data) {
    this.client.messages
      .create(this.domain, data)
      .then((res) => {
        console.log(res);
      })
      .catch((err) => {
        console.error(err);
      });
  }
}
