import { shadowDifferences } from './shadowDifference';

it('limits differences and never emits arbitrary keys, names, identifiers, scores or text values', () => {
  const saved = JSON.stringify({
    name: 'PRIVATE_NAME',
    PRIVATE_KEY: 'PRIVATE_VALUE',
    sets: [1, 2],
    matchUpStatus: 'COMPLETED',
    participantId: 'PRIVATE_ID',
  });
  const shadow = JSON.stringify({
    name: 'OTHER_NAME',
    PRIVATE_KEY: 671,
    sets: [1],
    matchUpStatus: 'PRIVATE_STATUS',
    participantId: 'OTHER_ID',
  });
  expect(shadowDifferences(saved, shadow, 'draw[0]', 4)).toEqual([
    'draw[0].name saved=string shadow=string',
    'draw[0].[field] saved=string shadow=number',
    'draw[0].sets saved=array(2) shadow=array(1)',
    'draw[0].matchUpStatus saved=COMPLETED shadow=string',
  ]);
});

it('describes an order-only difference under the existing canonical comparison', () => {
  expect(shadowDifferences('{"a":1,"b":2}', '{"b":2,"a":1}', 'draw[0]', 4)).toEqual(['draw[0] field-order']);
});
