import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_CALENDAR, BASE_PROVIDER } from 'src/services/levelDB/constants';

@Injectable()
export class ProvidersService {
  async getCalendar({ providerAbbr }) {
    return await netLevel.get(BASE_CALENDAR, { key: providerAbbr });
  }

  async getProvider({ providerId }) {
    return await netLevel.get(BASE_PROVIDER, { key: providerId });
  }

  async getProviders() {
    return await netLevel.list(BASE_PROVIDER, { all: true });
  }
}
