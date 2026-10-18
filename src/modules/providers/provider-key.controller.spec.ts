import { mocksEngine } from 'tods-competition-factory';

import { ProviderKeyController } from './provider-key.controller';

/**
 * A record posted with a provider key is migrated before it is saved. An integrator's hand-built draws (2026-10-18)
 * stored no `winnerMatchUpId` / `loserMatchUpId`, so no bracket could be drawn until a scored matchUp stored them.
 */
const PROVIDER_ID = 'provider-key-spec';

function makeController() {
  const saved: any[] = [];
  const factoryService: any = {
    saveTournamentRecords: async (params: any) => {
      saved.push(params);
      return { success: true };
    },
  };
  const controller = new ProviderKeyController(factoryService, {} as any);
  return { controller, saved };
}

function recordWithoutEdges() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 8 }],
    tournamentAttributes: { parentOrganisation: { organisationId: PROVIDER_ID } },
  });
  const matchUps = tournamentRecord.events[0].drawDefinitions[0].structures[0].matchUps;
  for (const matchUp of matchUps) delete matchUp.winnerMatchUpId;
  return tournamentRecord;
}

const winnerEdges = (tournamentRecord: any) =>
  tournamentRecord.events[0].drawDefinitions[0].structures[0].matchUps.filter((matchUp: any) => matchUp.winnerMatchUpId)
    .length;

const req = { provider: { providerId: PROVIDER_ID }, user: {}, userContext: undefined };

describe('ProviderKeyController.saveTournament', () => {
  it('stores the edges of a draw posted without them', async () => {
    const { controller, saved } = makeController();
    const tournamentRecord = recordWithoutEdges();
    expect(winnerEdges(tournamentRecord)).toBe(0);

    const result: any = await controller.saveTournament({ tournamentRecord }, req);
    expect(result.success).toBe(true);

    const stored = saved[0].tournamentRecords[tournamentRecord.tournamentId];
    expect(winnerEdges(stored)).toBe(6); // every matchUp but the final
  });

  it('migrates every record of a multi-record save', async () => {
    const { controller, saved } = makeController();
    const first = recordWithoutEdges();
    const second = recordWithoutEdges();

    await controller.saveTournament(
      { tournamentRecords: { [first.tournamentId]: first, [second.tournamentId]: second } },
      req,
    );

    const stored = saved[0].tournamentRecords;
    expect(winnerEdges(stored[first.tournamentId])).toBe(6);
    expect(winnerEdges(stored[second.tournamentId])).toBe(6);
  });

  it('refuses a record under another provider before migrating anything', async () => {
    const { controller, saved } = makeController();
    const tournamentRecord = recordWithoutEdges();
    tournamentRecord.parentOrganisation = { organisationId: 'another-provider' };

    const result: any = await controller.saveTournament({ tournamentRecord }, req);
    expect(result.error).toBe('Provider mismatch');
    expect(saved).toHaveLength(0);
    expect(winnerEdges(tournamentRecord)).toBe(0);
  });
});
