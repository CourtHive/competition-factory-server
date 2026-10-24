import { upstreamCredentialProblem } from './upstreamCredential';

describe('upstreamCredentialProblem', () => {
  it('accepts a provider API key, the one bearer upstream POST /factory takes besides a JWT', () => {
    expect(upstreamCredentialProblem('pkey_abc123')).toBeUndefined();
  });

  it('names an unset key', () => {
    expect(upstreamCredentialProblem(undefined)).toContain('unset');
    expect(upstreamCredentialProblem('')).toContain('unset');
  });

  it('names a static shared secret, which upstream refuses on every drain', () => {
    const problem = upstreamCredentialProblem('a-shared-venue-secret');
    expect(problem).toContain('not a provider API key');
  });
});
