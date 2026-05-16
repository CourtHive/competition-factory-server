import { Injectable } from '@nestjs/common';

import { FederationDataAdapter } from '../../FederationDataAdapter';
import { ctsFetch } from './fetch';

// Czech Tennis Association (Český tenisový svaz / ČTS) federation-data
// adapter. Reference implementation of `FederationDataAdapter`.
//
// `canHandle()` recognizes the CTS tournament-page URL shape, which uses
// path segments `turnaj/<tournamentId>/sezona/<season>`. Examples:
//   https://www.cztenis.cz/turnaj/12345/sezona/2026/
//   https://cesky-tenis.cz/turnaj/12345/sezona/2026

@Injectable()
export class CtsAdapter implements FederationDataAdapter {
  readonly provider = 'CTS';
  readonly organizationId = '7c10416b-9b4b-45c9-9762-efa4e2efc2cb';

  canHandle(identifier: string): boolean {
    if (typeof identifier !== 'string') return false;
    const lower = identifier.toLowerCase();
    if (!lower.startsWith('http')) return false;
    const parts = lower.split('/').filter((p) => p && p !== '/');
    return parts.includes('turnaj') && parts.includes('sezona');
  }

  async fetchTournament(identifier: string) {
    const parts = identifier
      .toLowerCase()
      .split('/')
      .filter((p) => p && p !== '/');
    const turnajIdx = parts.indexOf('turnaj');
    const sezonaIdx = parts.indexOf('sezona');
    if (turnajIdx < 0 || sezonaIdx < 0) return { error: 'Invalid CTS identifier' };
    const tournamentId = parts[turnajIdx + 1];
    const season = parts[sezonaIdx + 1];
    if (!tournamentId || !season) return { error: 'Invalid CTS identifier' };
    return ctsFetch({ identifier, tournamentId });
  }
}
