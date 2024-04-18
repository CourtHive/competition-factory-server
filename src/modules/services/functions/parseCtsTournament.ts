export function parseCtsTournament({ tournamentId, doc }) {
  const details = doc.querySelector('.span6');
  if (!details) return { error: 'Parsing Error' };

  const category = getCategory({ tournamentId });
  const gender = getGender({ tournamentId });

  const indexValue = {};
  const keyValue = {};

  details.querySelectorAll('tr').forEach((row, index) => {
    const cols = row.querySelectorAll('td');
    keyValue[cols[0].text] = { index, text: cols[1].text };
    indexValue[index] = cols[1].text;
  });

  const tournamentRecord: any = getTournamentDetails({ tournamentId, category, keyValue, indexValue });
  const { startDate } = tournamentRecord;

  const firstHeader = doc.querySelector('h3');
  const relevantNodes = firstHeader?.parentNode.childNodes;
  if (relevantNodes) {
    const participants: any = [];
    let sectionType;
    relevantNodes.forEach((row) => {
      if (row.tagName?.toLowerCase() === 'h3') {
        sectionType = getSectionType(row.text);
      }
      if (row.tagName?.toLowerCase() === 'tr') {
        const participant: any = getParticipant(row, sectionType, category, gender, startDate).participant;
        if (participant?.person?.birthDate) participants.push(participant);
      }
    });
    tournamentRecord.participants = participants;
  }

  return tournamentRecord;
}

function getSectionType(header) {
  if (header == 'Hlavní soutěž' || header == 'Seznam přihlášených') {
    return 'registered';
  } else if (header == 'Kvalifikace') {
    return 'qualification';
  } else if (header == 'Náhradníci') {
    return 'substitute';
  } else if (header == 'Seznam odstraněných') {
    return 'withdrawn';
  }

  return '';
}

function getTournamentDetails({ tournamentId, category, keyValue, indexValue }) {
  const { text: dates } = keyValue['Datum:'] || {};
  const month = dates
    .split('.')
    .filter((f) => f)
    .reverse()[0];
  const start_day = dates.split('.')[0];
  const end_day = dates
    .split('.')
    .reduce((p, c) => (c.indexOf('-') == 0 ? c : p), undefined)
    .replace(/^\D+/g, '');
  const year = new Date().getFullYear();
  const startDate = `${year}-${month}-${start_day}`;
  const endDate = `${year}-${month}-${end_day}`;

  const { text: tournamentName } = keyValue['Název:'] || keyValue['Pořadatel:'] || {};
  const { text: ballType } = keyValue['Míče:'] || {};
  const { text: drawSize } = keyValue['Počet účastníků:'] || {};

  const { text: organizationName } = keyValue['Pořadatel:'] || {};
  const { text: telephone } = keyValue['Tel. (1):'] || {};
  const { text: email } = keyValue['E-mail:'] || {};
  const { text: website } = keyValue['Internet:'] || {};
  const { text: contactName, index } = keyValue['Kontaktní osoba:'] || {};
  const addressLine1 = indexValue[index + 1];
  const addressLine2 = indexValue[index + 2];

  let surfaceCategory;
  const { text: courts_surface } = keyValue['Dvorců + povrch:'] || {};
  if (courts_surface) {
    if (courts_surface.toLowerCase().indexOf('antuka') >= 0) surfaceCategory = 'CLAY';
    if (courts_surface.toLowerCase().indexOf('bergo') >= 0) surfaceCategory = 'HARD';
    if (courts_surface.toLowerCase().indexOf('sol') >= 0) surfaceCategory = 'HART';
    if (courts_surface.toLowerCase().indexOf('beton') >= 0) surfaceCategory = 'HARD';
    if (courts_surface.toLowerCase().indexOf('akryl') >= 0) surfaceCategory = 'HARD';
    if (courts_surface.toLowerCase().indexOf('tráva') >= 0) surfaceCategory = 'GRASS';
    if (courts_surface.toLowerCase().indexOf('supreme') >= 0) surfaceCategory = 'CLAY';
  }

  const categories = [category];

  const onlineResources = [
    {
      name: 'Tournament website',
      resourceSubType: 'WEBSITE',
      resourceType: 'URL',
      identifier: website,
    },
  ];

  const contact = { contactName, telephone, email };
  const address = { addressLine1, addressLine2 };
  const extensions = [
    {
      value: { drawSize, ballType, categories, surfaceCategory, address, contact },
      name: 'tournamentProfile',
    },
  ];

  const tournamentRecord = {
    parentOrganisation: { organizationName, onlineResources, organisationId: '7c10416b-9b4b-45c9-9762-efa4e2efc2cb' },
    tournamentId: `CZE${tournamentId}`,
    tournamentName,
    extensions,
    startDate,
    endDate,
  };

  return tournamentRecord;
}

function getCategory({ tournamentId }) {
  const cf = tournamentId[0];
  if (['9'].includes(cf)) return 'U10';
  if (['7', '8'].includes(cf)) return 'U12';
  if (['5', '6'].includes(cf)) return 'U14';
  if (['3', '4'].includes(cf)) return 'U18';
  if (['1', '2'].includes(cf)) return 'Adult';
  return 'All';
}

function getGender({ tournamentId }) {
  const cf = tournamentId[0];
  if (['1', '3', '5', '7'].includes(cf)) return 'MALE';
  if (['2', '4', '6', '8'].includes(cf)) return 'FEMALE';
  return 'ANY';
}

function getParticipant(row, sectionType, category, gender, startDate) {
  const participantStatus = sectionType === 'withdrawn' ? 'WITHDRAWN' : 'ACTIVE';
  const participant: any = {
    participantType: 'INDIVIDUAL',
    participantRole: 'COMPETITOR',
    person: { sex: gender },
    participantStatus,
    timeItems: [],
  };

  const signInStatus = sectionType === 'withdrawn' ? 'WITHDRAWN' : 'SIGNED_IN';
  if (sectionType === 'substitute') participant.entryStatus = 'ALTERNATE';
  if (sectionType === 'qualification') participant.entryStage = 'QUALIFYING';

  row.querySelectorAll('td').forEach((col, i) => {
    const value = col.text;
    if (i == 1) {
      participant.participantName = value;
      const [standardFamilyName, standardGivenName] = (value || '').split(' ');
      Object.assign(participant.person, { standardGivenName, standardFamilyName });

      const a = col.querySelector('a');
      if (a?.rawAttrs) {
        const id = a.rawAttrs.split('"').join('');
        const participantId = `CZE${id.split('/').reverse()[0]}`;
        participant.participantId = participantId;
        participant.person.personId = participantId;
      }
    }

    if (i == 2 && value.split('.').length == 3) {
      participant.person.birthDate = value.split('.').reverse().join('-');
    }

    if (i == 3) participant.person.clubName = value;

    if (i == 4) {
      const ranking = numeric(value);
      const scaleItem = {
        itemType: `SCALE.RANKING.SINGLES.${category}`,
        timeStamp: startDate,
        itemValue: ranking,
      };
      participant.timeItems.push(scaleItem);
    }

    if (i == 5) {
      const doublesRanking = numeric(value);
      const scaleItem = {
        itemType: `SCALE.RANKING.DOUBLES.${category}`,
        itemValue: doublesRanking,
        timeStamp: startDate,
      };
      participant.timeItems.push(scaleItem);
    }

    if (i == 8) {
      const registrationTime = (value || '').split(' ').join('T');
      const timeItem = {
        itemSubject: 'SIGN_IN_STATUS',
        itemValue: signInStatus,
        timeStamp: registrationTime,
      };
      participant.timeItems.push(timeItem);
    }
  });

  return { participant };
}

function numeric(value) {
  return value && !isNaN(value) ? parseInt(value.toString().slice(-4)) : undefined;
}
