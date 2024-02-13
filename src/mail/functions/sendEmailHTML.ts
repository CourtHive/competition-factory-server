// import * as FormData from 'form-data';
// import Mailgun from 'mailgun.js';
import ejs from 'ejs';
import fs from 'fs';

// import { serverPath } from '../../../constants/path';

export async function sendEmailHTML({ to, subject, templateName, templateData }) {
  const template = `./templates/${templateName}.ejs`;
  const htmlFile = fs.readFileSync(template, 'utf8');
  const compiled = ejs.compile(htmlFile);
  const html = compiled(templateData);
  const data = {
    from: 'info@courthive.com',
    to,
    subject,
    html,
  };
  !!data;

  /*
  const mailgun = new Mailgun(FormData);

  const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY || 'key-yourkeyhere',
    proxy: {
      protocol: 'https', // 'http' ,
      host: '127.0.0.1', // use your proxy host here
      port: 9000, // use your proxy port here
      auth: {
        // may be omitted if proxy doesn't require authentication
        username: 'user_name', // provide username
        password: 'user_password', // provide password
      },
    },
  });
  MailGun()
    .messages()
    .send(data, function (error, body) {
      if (error) {
        console.log({ error });
      } else {
        console.log(body);
      }
    });
    */
}
