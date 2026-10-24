/**
 * Why the mutation mirror's upstream credential will be refused, or undefined when it can be accepted.
 *
 * The mirror posts to upstream `POST /factory` with `Bearer UPSTREAM_API_KEY`. That route accepts a user
 * JWT or, through `ProviderApiKeyMiddleware`, a provider API key (`pkey_…`) acting for its own provider.
 * `UPSTREAM_API_KEY` is otherwise a static shared secret checked only by the export controller, so any
 * value that is not a provider key is refused (401) on every drain, and the queue stops at its first
 * entry for good. Nothing said so: this exists to make that visible at boot.
 */
const PROVIDER_KEY_PREFIX = 'pkey_';

export function upstreamCredentialProblem(upstreamApiKey: string | undefined): string | undefined {
  if (!upstreamApiKey) {
    return 'UPSTREAM_API_KEY is unset, and upstream POST /factory requires authentication';
  }
  if (!upstreamApiKey.startsWith(PROVIDER_KEY_PREFIX)) {
    return `UPSTREAM_API_KEY is not a provider API key (${PROVIDER_KEY_PREFIX}…); upstream POST /factory accepts a user JWT or a provider key`;
  }
  return undefined;
}
