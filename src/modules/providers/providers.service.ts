import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_CALENDAR, BASE_PROVIDER } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class ProvidersService {
  async getCalendar({ providerAbbr }) {
    const calendar = await netLevel.get(BASE_CALENDAR, { key: providerAbbr });
    if (!calendar) return { success: false, message: 'No calendar found' };
    return { ...SUCCESS, calendar };
  }

  async getProvider({ providerId }) {
    const provider = await netLevel.get(BASE_PROVIDER, { key: providerId });
    if (!provider) return { success: false, message: 'No provider found' };
    return { ...SUCCESS, provider };
  }

  async getProviders() {
    const providers = await netLevel.list(BASE_PROVIDER, { all: true });
    if (!providers) return { success: false, message: 'No providers found' };
    return { ...SUCCESS, providers };
  }
}
