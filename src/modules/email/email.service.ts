import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

@Injectable()
export class MailgunService {
  constructor(private readonly configService: ConfigService) {}
  private domain = this.configService.get('email').domain || '';
  private key = this.configService.get('email').key;
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
