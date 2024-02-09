import { SUCCESS, UTF8 } from 'src/common/constants/app';
import { getMatchStats } from './getMatchStats';
import fs from 'fs-extra';

export function saveMatchPoints({ matchUp }) {
  const destination = '/tracker';
  const cacheDir = process.env.TRACKER_CACHE;
  fs.ensureDirSync(cacheDir + destination);

  const provider = matchUp.provider || '';
  if (provider) fs.ensureDirSync(cacheDir + destination + '/' + provider);

  const matchUpId = matchUp.muid || matchUp.matchUpId;
  const providerDestination = provider ? `/${provider}` : '';
  const fileName = `${cacheDir}${destination}${providerDestination}/${matchUpId}.json`;

  fs.writeFile(fileName, JSON.stringify(matchUp, null, 2), UTF8, function (err) {
    if (!err) {
      return { ...SUCCESS };
    } else {
      return { error: err };
    }
  });

  const stats = getMatchStats({ source: matchUp });
  if (stats?.length) {
    const statsFileName = `${cacheDir}${destination}${providerDestination}/${matchUpId}.stats.json`;
    fs.writeFile(statsFileName, JSON.stringify(stats, null, 2), UTF8, function (err) {
      if (!err) {
        return SUCCESS;
      } else {
        return { error: err };
      }
    });
  }

  return true;
}
