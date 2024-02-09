import { convertTMX2TODS } from 'tods-tmx-classic-converter';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ConversionService {
  ping(): any {
    return { alive: true };
  }
  async convertTournament(params) {
    if (!params?.tournament) return { error: 'No tournament provided' };
    return convertTMX2TODS(params);
  }
}
