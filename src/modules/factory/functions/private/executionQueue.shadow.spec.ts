import { resetShardShadowStats, shardShadowStats } from '../../helpers/executionQueueShadow';
import { installFootprintStandIn } from 'src/tests/helpers/footprintStandIn';
import { mocksEngine, tournamentEngine } from 'tods-competition-factory';
import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

/**
 * executionQueue with the shard shadow sampling every eligible mutation: the check runs after the response, finds the
 * partial run's draw equal to the saved one, and changes nothing the mutation itself returns or saves.
 */
const {
  tournamentRecord: template,
  drawIds: [drawId],
} = mocksEngine.generateTournamentRecord({ drawProfiles: [{ drawSize: 8 }, { drawSize: 4 }] });
const tournamentId = template.tournamentId;

tournamentEngine.setState(template);
const matchUp: any = tournamentEngine
  .allTournamentMatchUps({ inContext: true })
  .matchUps?.find((m: any) => m.drawId === drawId && m.roundNumber === 1);
const methods = () => [
  {
    method: 'setMatchUpStatus',
    params: {
      drawId,
      matchUpId: matchUp.matchUpId,
      outcome: {
        winningSide: 1,
        matchUpStatus: 'COMPLETED',
        sets: [{ setNumber: 1, side1Score: 6, side2Score: 0, winningSide: 1 }],
      },
    },
  },
];

function storage() {
  const saved: Record<string, any>[] = [];
  return {
    saved,
    fetchTournamentRecords: vi.fn(async () => ({
      success: true,
      tournamentRecords: { [tournamentId]: structuredClone(template) },
    })),
    saveTournamentRecords: vi.fn(async ({ tournamentRecords }: any) => {
      saved.push(structuredClone(tournamentRecords));
      return { success: true };
    }),
  };
}

const run = async (rate?: string) => {
  if (rate) process.env.SHARD_SHADOW_SAMPLE_RATE = rate;
  else delete process.env.SHARD_SHADOW_SAMPLE_RATE;
  const persisted = storage();
  const result: any = await executionQueue(
    { tournamentIds: [tournamentId], methods: methods() },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  return { result, persisted };
};

describe('executionQueue with the shard shadow', () => {
  const ORIGINAL = { ...process.env };
  let uninstall: () => void;

  beforeEach(() => {
    resetShardShadowStats();
    uninstall = installFootprintStandIn();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    uninstall();
  });

  it('checks a sampled score entry after the response, and finds the same draw', async () => {
    const { result } = await run('1');
    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(shardShadowStats()).toMatchObject({ sampled: 1, pending: 0, match: 1 }));
    expect(shardShadowStats()).toMatchObject({ mismatch: 0, refused: 0, error: 0 });
  });

  it('changes nothing the mutation returns or saves', async () => {
    const off = await run();
    const on = await run('1');
    await vi.waitFor(() => expect(shardShadowStats().pending).toBe(0));
    const strip = (value: any) =>
      JSON.stringify(value, (key, v) =>
        ['updatedAt', 'createdAt', 'scoredTime', 'timeStamp'].includes(key) ? undefined : v,
      );
    expect(strip(on.persisted.saved)).toEqual(strip(off.persisted.saved));
    expect(on.result.publicNotices.length).toBe(off.result.publicNotices.length);
    expect(shardShadowStats()).toMatchObject({ sampled: 1, match: 1 });
  });
});
