import { convertTMX2TODS } from 'tods-tmx-classic-converter';
import netLevel from './netLevel.mjs';
import minimist from 'minimist';
import fs from 'fs-extra';
import 'dotenv/config';

const UTF8 = 'utf8';

const args = minimist(process.argv.slice(2), {
  default: { path: './cache/tournaments', limit: 0, verbose: false },
  alias: { p: 'path', l: 'limit', v: 'verbose' },
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
  const tournamentIds = [];
  const providers = {};
  let calendarCount = 0;
  let added = 0;
  let count = 0;

  for (const fileName of fileNames) {
    if (args.limit && count++ > args.limit) break;
    const tournamentRaw = fs.readFileSync(`${tournamentsPath}/${fileName}`, UTF8);

    let legacyTournamentRecord;
    let tournamentRecord;
    try {
      legacyTournamentRecord = JSON.parse(tournamentRaw);
      if (legacyTournamentRecord?.doNotProcess) {
        args.verbose && console.log('DO NOT PROCESS', legacyTournamentRecord?.tuid);
        continue;
      }
      tournamentRecord = convertTMX2TODS({ tournament: legacyTournamentRecord, verbose: false }).tournamentRecord;
    } catch (err) {
      console.log('error', { fileName, err });
      continue;
    }

    const { name: tournamentName, tuid } = legacyTournamentRecord;

    if (legacyTournamentRecord?.players?.length < 2) {
      args.verbose && console.log('NO PLAYERS', { tournamentId: tuid, tournamentName });
      continue;
    }
    if (!legacyTournamentRecord?.events?.length) {
      args.verbose && console.log('NO PLAYERS', { tournamentId: tuid, tournamentName });
      continue;
    }

    if (tournamentRecord?.tournamentId) {
      const { tournamentId, tournamentName, startDate, endDate } = tournamentRecord;
      if (tournamentIds.includes(tournamentId)) {
        console.log('DUPLICATE', { tournamentId });
        continue;
      }

      await netLevel.set('tournamentRecord', { key: tournamentId, value: tournamentRecord });
      tournamentIds.push(tournamentId);
      added++;

      if (!tournamentRecord.parentOrganisation?.organisationId) {
        console.log('NO PROVIDER', { tournamentId });
        continue;
      }
      if (tournamentRecord.isMock) {
        console.log('IS MOCK', { tournamentId });
        continue;
      }

      const providerId = tournamentRecord.parentOrganisation?.organisationId;
      providers[providerId] = tournamentRecord.parentOrganisation;
      if (!providerCalendars[providerId]) providerCalendars[providerId] = [];

      // deprecate this!
      const tournamentImageURL = tournamentRecord.onlineResources.find(
        (resource) =>
          resource.resourceType === 'URL' &&
          resource.resourceSubType === 'IMAGE' &&
          resource.name === 'tournamentImage',
      )?.identifier;

      const calendarEntry = {
        searchText: tournamentName.toLowerCase(),
        tournamentId,
        providerId,
        tournament: {
          startDate: new Date(startDate).toISOString().split('T')[0],
          endDate: new Date(endDate).toISOString().split('T')[0],
          onLineResources: tournamentRecord.onlineResources,
          tournamentImageURL, // deprecate this!
          tournamentName,
        },
      };

      providerCalendars[providerId].push(calendarEntry);
      calendarCount++;
    }
  }

  for (const providerId of Object.keys(providerCalendars)) {
    const tournaments = providerCalendars[providerId];
    const provider = providers[providerId];
    await netLevel.set('provider', { key: providerId, value: provider });

    const key = provider?.organisationAbbreviation ?? provider?.organisationId;
    if (key) {
      const existingCalendar = await netLevel.get('calendar', key);
      const existingTournaments = existingCalendar?.value.tournaments ?? [];
      const newTournaments = tournaments.filter(
        (t) => !existingTournaments.find((et) => et.tournamentId === t.tournamentId),
      );
      await netLevel.set('calendar', {
        key,
        value: { provider, tournaments: [...existingTournaments, ...newTournaments] },
      });
    }
  }

  const calendarTournamentIds = Object.values(providerCalendars).flatMap((tournaments) =>
    tournaments.map((t) => t.tournamentId),
  );
  const missingTournamentIds = tournamentIds.filter((id) => !calendarTournamentIds.includes(id));
  console.log({ added, calendarCount, calendarTournamentIdCount: calendarTournamentIds.length, missingTournamentIds });
}
