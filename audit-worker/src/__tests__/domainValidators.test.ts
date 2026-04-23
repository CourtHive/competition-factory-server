import { describe, it, expect } from 'vitest';
import { validateDrawIntegrity, validateScheduleIntegrity } from '../validators/domainValidators.js';

describe('validateDrawIntegrity', () => {
  it('passes a clean draw', () => {
    const record = {
      participants: [
        { participantId: 'p-1' },
        { participantId: 'p-2' },
      ],
      events: [{
        drawDefinitions: [{
          drawName: 'Main',
          structures: [{
            structureName: 'Main',
            structureId: 's-1',
            positionAssignments: [
              { drawPosition: 1, participantId: 'p-1' },
              { drawPosition: 2, participantId: 'p-2' },
            ],
            seedAssignments: [
              { seedNumber: 1, participantId: 'p-1' },
            ],
          }],
          links: [],
        }],
      }],
    };

    let result: any = validateDrawIntegrity(record);
    expect(result.errors).toHaveLength(0);
  });

  it('catches duplicate participantIds in position assignments', () => {
    const record = {
      participants: [{ participantId: 'p-1' }],
      events: [{
        drawDefinitions: [{
          drawName: 'Main',
          structures: [{
            structureName: 'Main',
            structureId: 's-1',
            positionAssignments: [
              { drawPosition: 1, participantId: 'p-1' },
              { drawPosition: 2, participantId: 'p-1' },
            ],
          }],
        }],
      }],
    };

    let result: any = validateDrawIntegrity(record);
    expect(result.errors.some((e: string) => e.includes('Duplicate'))).toBe(true);
  });

  it('catches unknown participantId in position assignments', () => {
    const record = {
      participants: [{ participantId: 'p-1' }],
      events: [{
        drawDefinitions: [{
          drawName: 'Main',
          structures: [{
            structureName: 'Main',
            structureId: 's-1',
            positionAssignments: [
              { drawPosition: 1, participantId: 'p-unknown' },
            ],
          }],
        }],
      }],
    };

    let result: any = validateDrawIntegrity(record);
    expect(result.errors.some((e: string) => e.includes('unknown participantId'))).toBe(true);
  });

  it('catches unknown participantId in seed assignments', () => {
    const record = {
      participants: [{ participantId: 'p-1' }],
      events: [{
        drawDefinitions: [{
          drawName: 'Main',
          structures: [{
            structureName: 'Main',
            structureId: 's-1',
            positionAssignments: [],
            seedAssignments: [{ seedNumber: 1, participantId: 'p-ghost' }],
          }],
        }],
      }],
    };

    let result: any = validateDrawIntegrity(record);
    expect(result.errors.some((e: string) => e.includes('Seed assignment'))).toBe(true);
  });

  it('catches broken structure links', () => {
    const record = {
      participants: [],
      events: [{
        drawDefinitions: [{
          drawName: 'Main',
          structures: [{ structureId: 's-1', positionAssignments: [] }],
          links: [{ source: { structureId: 's-1' }, target: { structureId: 's-nonexistent' } }],
        }],
      }],
    };

    let result: any = validateDrawIntegrity(record);
    expect(result.errors.some((e: string) => e.includes('unknown target structureId'))).toBe(true);
  });
});

describe('validateScheduleIntegrity', () => {
  it('passes when no scheduled matchUps', () => {
    const record = {
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      events: [],
    };

    let result: any = validateScheduleIntegrity(record);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about matchUp scheduled outside tournament dates', () => {
    const record = {
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      events: [{
        drawDefinitions: [{
          structures: [{
            matchUps: [{
              schedule: { scheduledDate: '2026-07-15' },
            }],
          }],
        }],
      }],
    };

    let result: any = validateScheduleIntegrity(record);
    expect(result.warnings.some((w: string) => w.includes('outside tournament dates'))).toBe(true);
  });

  it('passes matchUp within tournament dates', () => {
    const record = {
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      events: [{
        drawDefinitions: [{
          structures: [{
            matchUps: [{
              schedule: { scheduledDate: '2026-06-02' },
            }],
          }],
        }],
      }],
    };

    let result: any = validateScheduleIntegrity(record);
    expect(result.warnings).toHaveLength(0);
  });
});
