import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

@Injectable()
export class MailgunService {
  constructor(private readonly config: ConfigService) {}
  // mailgun secret key
  // private MAILGUN_KEY = this.config.get<string>('MAILGUN_KEY');
  // private MAILGUN_DOMAIN = this.config.get<string>('MAILGUN_DOMAIN');
  private MAILGUN_KEY = 'MAILGUN_KEY';
  private MAILGUN_DOMAIN = 'MAILGUN_DOMAIN';
  private client = new Mailgun(FormData).client({
    key: this.MAILGUN_KEY,
    username: 'api',
  });
  /**
   * Send via API
   *
   * @param data
   */
  async sendMail(data) {
    this.client.messages
      .create(this.MAILGUN_DOMAIN, data)
      .then((res) => {
        console.log(res);
      })
      .catch((err) => {
        console.error(err);
      });
  }
}
