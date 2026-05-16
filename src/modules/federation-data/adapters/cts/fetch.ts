import { parse } from 'node-html-parser';
import axios from 'axios';

import { ctsParse } from './parse';

// Fetches and parses a single CTS tournament page. Storage side-effects are
// the dispatcher's responsibility — this function returns the parsed record
// (or an error) without touching the DB.

export async function ctsFetch({ identifier, tournamentId }: { identifier: string; tournamentId: string }) {
  try {
    const result = await axios.request({ url: identifier, method: 'GET', headers: { Accept: 'application/json' } });
    const doc = parse(result.data);
    const tournamentRecord: any = ctsParse({ doc, tournamentId });
    if (tournamentRecord?.error) return tournamentRecord;
    return tournamentRecord;
  } catch {
    return { error: `request failed` };
  }
}
