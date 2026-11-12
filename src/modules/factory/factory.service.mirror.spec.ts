import { FactoryService } from './factory.service';

const executionQueue = vi.hoisted(() => vi.fn());
vi.mock('./functions/private/executionQueue', () => ({ executionQueue }));

// The mirror replays methods against an upstream copy, as a desk applies the broadcast. It must carry the canonical
// methods: an intention that wrote nothing here would record an attestation upstream that this server never held.

function makeFactoryService() {
  const mutationMirror: any = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const mutationServices: any = { build: vi.fn(() => ({})) };
  const svc = new FactoryService(
    {} as any,
    {} as any,
    mutationServices,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    mutationMirror,
  );
  return { svc, mutationMirror };
}

const intention = { method: 'setParticipantCheckInState', params: { checkedIn: true } };

describe('FactoryService.executionQueue mutation mirror', () => {
  afterEach(() => executionQueue.mockReset());

  it('mirrors the canonical appliedMethods', async () => {
    const applied = [{ ...intention, params: { ...intention.params, attestationId: 'a1' } }];
    executionQueue.mockResolvedValue({ success: true, appliedMethods: applied });
    const { svc, mutationMirror } = makeFactoryService();

    await svc.executionQueue({ tournamentIds: ['t1'], methods: [intention] }, {});

    expect(mutationMirror.enqueue).toHaveBeenCalledWith({ tournamentIds: ['t1'], methods: applied });
  });

  it('mirrors nothing when every intention was already satisfied', async () => {
    executionQueue.mockResolvedValue({ success: true, appliedMethods: [] });
    const { svc, mutationMirror } = makeFactoryService();

    await svc.executionQueue({ tournamentIds: ['t1'], methods: [intention] }, {});

    expect(mutationMirror.enqueue).not.toHaveBeenCalled();
  });

  it('mirrors the sent methods when the server did not rewrite them', async () => {
    const methods = [{ method: 'setTournamentName', params: { tournamentName: 'x' } }];
    executionQueue.mockResolvedValue({ success: true });
    const { svc, mutationMirror } = makeFactoryService();

    await svc.executionQueue({ tournamentIds: ['t1'], methods }, {});

    expect(mutationMirror.enqueue).toHaveBeenCalledWith({ tournamentIds: ['t1'], methods });
  });
});
