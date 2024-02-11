import { generateKeyCode } from '../helpers/generateKeyCode';
import netLevel from 'src/services/levelDB/netLevel';

import { BASE_BEARER_TOKEN } from 'src/services/levelDB/constants';
import { SERVER_ERROR } from 'src/common/constants/errors';

export async function generateAuthToken({ email, tournamentId, expirationDate }) {
  const token = generateKeyCode();
  const storageRecord = {
    value: { email, tournamentId, expirationDate },
    key: token,
  };

  try {
    await netLevel.set(BASE_BEARER_TOKEN, storageRecord);
    return { token };
  } catch (err) {
    return { error: SERVER_ERROR };
  }
}
