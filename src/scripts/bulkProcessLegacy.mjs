import { convertTMX2TODS } from 'tods-tmx-classic-converter';
import netLevel from './netLevel.mjs';
import minimist from 'minimist';
import fs from 'fs-extra';

const UTF8 = 'utf8';

const args = minimist(process.argv.slice(2), {
  default: { path: './cache/tournaments', limit: 0 },
  alias: { p: 'path', l: 'limit' },
});

createProviderCalendars(args.path).then(() => {
  console.log('done');
  process.exit();
});

export async function createProviderCalendars(tournamentsPath) {
  let directoryContents;
  try {
    directoryContents = fs.readdirSync(tournamentsPath);
  } catch (err) {
    console.log('error', { err });
    return;
  }
  const fileNames = directoryContents.filter((name) => name.endsWith('.circular.json'));

  const providerCalendars = {};
  const providers = {};
  let count = 0;

  for (const fileName of fileNames) {
    if (args.limit && count++ > args.limit) break;
    const tournamentRaw = fs.readFileSync(`${tournamentsPath}/${fileName}`, UTF8);

    let legacyTournamentRecord;
    let tournamentRecord;
    try {
      legacyTournamentRecord = JSON.parse(tournamentRaw);
      if (legacyTournamentRecord?.doNotProcess) {
        console.log('DO NOT PROCESS');
        continue;
      }
      tournamentRecord = convertTMX2TODS({ tournament: legacyTournamentRecord, verbose: true }).tournamentRecord;
    } catch (err) {
      console.log('error', { fileName, err });
      continue;
    }

    if (legacyTournamentRecord?.players?.length < 2) {
      continue;
    }
    if (!legacyTournamentRecord?.events?.length) {
      continue;
    }

    if (tournamentRecord?.tournamentId) {
      const { tournamentName, tournamentId, startDate, endDate, parentOrganisation } = tournamentRecord;
      await netLevel.set('tournamentRecord', { key: tournamentId, value: tournamentRecord });
      if (tournamentRecord.isMock) continue;

      const providerId = parentOrganisation?.organisationId;
      if (!providerId) continue;

      providers[providerId] = parentOrganisation;

      const tournamentImageURL = tournamentRecord.onlineResources.find(
        (resource) =>
          resource.resourceType === 'URL' &&
          resource.resourceSubType === 'IMAGE' &&
          resource.name === 'tournamentImage',
      )?.identifier;

      if (!providerCalendars[providerId]) providerCalendars[providerId] = [];

      const calendarEntry = {
        searchText: tournamentName.toLowerCase(),
        tournamentId,
        providerId,
        tournament: {
          startDate: new Date(startDate).toISOString().split('T')[0],
          endDate: new Date(endDate).toISOString().split('T')[0],
          tournamentImageURL,
          tournamentName,
        },
      };

      providerCalendars[providerId].push(calendarEntry);

      fs.writeFileSync(`${tournamentsPath}/${tournamentId}.tods.json`, JSON.stringify(tournamentRecord));
    }
  }

  for (const providerId of Object.keys(providerCalendars)) {
    const tournaments = providerCalendars[providerId];
    const provider = providers[providerId];
    await netLevel.set('provider', { key: providerId, value: provider });

    const abbr = provider?.organisationAbbreviation;
    abbr && (await netLevel.set('calendar', { key: abbr, value: { provider, tournaments } }));
  }
}
