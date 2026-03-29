/**
 * Shared test data for sanctioning e2e tests.
 * Mirrors real-world tournament applications from ITF, USTA, BWF.
 */

export const ITF_W50_APPLICATION = {
  governingBodyId: 'itf',
  sanctioningLevel: 'W50',
  applicant: {
    organisationId: 'e2e-test-org',
    organisationName: 'E2E Test Tennis Academy',
    contactName: 'Test Director',
    contactEmail: 'director@e2etest.com',
  },
  proposal: {
    tournamentName: 'E2E W50 Test Open',
    proposedStartDate: '2028-09-01',
    proposedEndDate: '2028-09-07',
    hostCountryCode: 'USA',
    surfaceCategory: 'HARD',
    indoorOutdoor: 'OUTDOOR',
    events: [
      {
        eventName: "Women's Singles",
        eventType: 'SINGLES',
        gender: 'FEMALE',
        drawSize: 32,
        drawType: 'SINGLE_ELIMINATION',
        matchUpFormat: 'SET3-S:6/TB7',
      },
      {
        eventName: "Women's Doubles",
        eventType: 'DOUBLES',
        gender: 'FEMALE',
        drawSize: 32,
      },
    ],
  },
};

export const USTA_LEVEL3_APPLICATION = {
  governingBodyId: 'usta',
  sanctioningLevel: 'Level 3',
  applicant: {
    organisationId: 'e2e-usta-club',
    organisationName: 'E2E Tennis Club',
    contactName: 'Jane Organizer',
    contactEmail: 'jane@e2eclub.com',
  },
  proposal: {
    tournamentName: 'E2E USTA Level 3 Championship',
    proposedStartDate: '2028-07-15',
    proposedEndDate: '2028-07-21',
    hostCountryCode: 'USA',
    surfaceCategory: 'HARD',
    indoorOutdoor: 'OUTDOOR',
    events: [
      {
        eventName: 'Open Singles',
        eventType: 'SINGLES',
        drawSize: 64,
        drawType: 'SINGLE_ELIMINATION',
      },
    ],
  },
};

export const WIZARD_BASIC_INFO = {
  tournamentName: 'Playwright Test Open 2028',
  startDate: '2028-06-01',
  endDate: '2028-06-07',
  country: 'USA',
  surface: 'HARD',
  indoorOutdoor: 'OUTDOOR',
  level: 'Level 3',
  governingBody: 'usta',
  orgName: 'Playwright Test Club',
  contactName: 'Playwright Tester',
  contactEmail: 'test@playwright.dev',
};

export const WIZARD_EVENT = {
  eventName: "Men's Singles",
  eventType: 'SINGLES',
  gender: 'MALE',
  drawSize: 32,
  drawType: 'SINGLE_ELIMINATION',
  matchUpFormat: 'SET3-S:6/TB7',
};
