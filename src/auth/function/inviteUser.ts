import { sendEmailHTML } from 'src/mail/functions/sendEmailHTML';
import { createUniqueKey } from '../helpers/createUniqueKey';
import netLevel from 'src/services/levelDB/netLevel';

import { BASE_USER_INVITE } from 'src/services/levelDB/constants';

export async function inviteUser({ invitation }) {
  const invite = {
    providerId: invitation.providerId,
  };
  const inviteCode = createUniqueKey();
  await netLevel.set(BASE_USER_INVITE, { key: inviteCode, value: invite });

  await sendEmailHTML({
    to: invitation.email,
    subject: 'Invitation',
    templateName: 'userInvitation',
    templateData: {
      invitationLink: `/newUser?code=${inviteCode}`,
    },
  });
}
