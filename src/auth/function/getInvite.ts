import { generateEmail } from 'src/modules/mail/functions/generateEmail';
import { createUniqueKey } from '../helpers/createUniqueKey';
import netLevel from 'src/services/levelDB/netLevel';

import { BASE_USER_INVITE } from 'src/services/levelDB/constants';

export async function getInvite(invitation) {
  const invite = { providerId: invitation.providerId };
  const inviteCode = createUniqueKey();

  await netLevel.set(BASE_USER_INVITE, { key: inviteCode, value: invite });

  return generateEmail({
    templateData: { invitationLink: `/newUser?code=${inviteCode}` },
    templateName: 'userInvitation',
    subject: 'Invitation',
    to: invitation.email,
  });
}
