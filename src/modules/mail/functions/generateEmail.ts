import ejs from 'ejs';
import fs from 'fs';

import { TEMPLATES } from 'src/common/constants/app';

export async function generateEmail({ to, subject, templateName, templateData }) {
  const template = `${TEMPLATES}/${templateName}.ejs`;
  const htmlFile = fs.readFileSync(template, 'utf8');
  const compiled = ejs.compile(htmlFile);
  const html = compiled(templateData);
  const data = {
    from: 'info@courthive.com',
    subject,
    html,
    to,
  };
  return data;
}
