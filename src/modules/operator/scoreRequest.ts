import { BadRequestException } from '@nestjs/common';
import { checkedObject, matchRequest } from './matchRequest';

export const operatorScorePrecondition = Symbol('operatorScorePrecondition');
const shortText = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
// A reason a side gave, keyed by side number, as the engine stores it. The positional array is not accepted.
const sideCodes = (value: unknown) =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.entries(value).every(([side, code]) => (side === '1' || side === '2') && shortText(code, 32));
export function scoreRequest(body: unknown) {
  const data = checkedObject(body, ['target', 'intent', 'revision', 'commandId', 'outcome']);
  const target = matchRequest(data.target);
  const { intent, revision, commandId } = data;
  if (
    (intent !== 'record-initial-result' && intent !== 'correct-result') ||
    (intent === 'correct-result'
      ? typeof revision !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(revision)
      : revision !== undefined) ||
    typeof commandId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(commandId)
  )
    throw new BadRequestException();
  const outcome = checkedObject(data.outcome, [
    'score',
    'matchUpStatus',
    'sideStatusCodes',
    'matchUpStatusCode',
    'clearStatusCodes',
    'winningSide',
    'matchUpFormat',
  ]);
  const { matchUpStatus, sideStatusCodes, matchUpStatusCode, clearStatusCodes, winningSide, matchUpFormat } = outcome;
  if (
    (matchUpStatus !== undefined && !shortText(matchUpStatus, 40)) ||
    (matchUpFormat !== undefined && !shortText(matchUpFormat, 128)) ||
    (winningSide !== undefined && winningSide !== 1 && winningSide !== 2) ||
    (sideStatusCodes !== undefined && !sideCodes(sideStatusCodes)) ||
    (matchUpStatusCode !== undefined && !shortText(matchUpStatusCode, 32)) ||
    (clearStatusCodes !== undefined && typeof clearStatusCodes !== 'boolean')
  )
    throw new BadRequestException();
  const score = checkedObject(outcome.score, ['sets']);
  if (!Array.isArray(score.sets) || score.sets.length > 20) throw new BadRequestException();
  for (const set of score.sets) {
    const values = checkedObject(set, [
      'setNumber',
      'side1Score',
      'side2Score',
      'side1TiebreakScore',
      'side2TiebreakScore',
      'winningSide',
      'side1PointScore',
      'side2PointScore',
    ]);
    for (const [key, value] of Object.entries(values)) {
      if (key.endsWith('PointScore') && shortText(value, 12)) continue;
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BadRequestException();
    }
  }
  return {
    target,
    intent,
    revision,
    commandId,
    outcome,
    emptyScore: (!matchUpStatus || matchUpStatus === 'TO_BE_PLAYED') && !winningSide && !score.sets.length,
  };
}
