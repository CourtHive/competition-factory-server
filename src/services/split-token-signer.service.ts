/**
 * SplitTokenSigner — CFS-side client that signs the SPLIT tournament tokens via
 * the HiveID IdP's internal /internal/mint endpoint (Increment 4 of the account
 * move; plan §2b, decision Q1-B).
 *
 * CFS keeps the SPLIT controllers + tournament/provisioner AUTHORIZATION (it owns
 * the data + `canMutateTournament`) but delegates SIGNING to the IdP, which alone
 * holds the private key. Mirrors DeclarationsClient / PersonsClient: Node native
 * fetch, base URL + shared service token from env, no new npm deps.
 *
 * INERT UNTIL POINTED AT THE IdP (matches the ES256 signer-flip pattern): with
 * `HIVEID_BASE_URL` unset the signer mints LOCALLY via signJwt — byte-identical
 * to the pre-Increment-4 call sites — so the code ships with zero behavior change
 * and the cutover is a single env toggle (reversible). `HIVEID_BASE_URL=disabled`
 * is an explicit local override for deployments without the IdP.
 *
 * Remote mode fails CLOSED (architectural-standards A3): if the IdP is
 * unreachable or rejects, the mint throws rather than falling back to a local
 * key — post-cutover CFS holds no key, so a local fallback would only mint HS256
 * tokens every verifier now rejects. One signer, everywhere.
 */
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { signJwt } from 'src/common/auth/signJwt';

const DEFAULT_HIVEID_BASE_URL = 'http://localhost:3140';

export type MintAudience = 'score' | 'provider' | 'admin';

export interface SplitMintArgs {
  /** Already-authorized claims to sign (e.g. sub, tournamentId, personId). `aud` is set from `audience`. */
  claims: Record<string, unknown>;
  audience: MintAudience;
  /** Token lifetime in seconds. The IdP additionally clamps to its own max TTL. */
  expiresInSeconds: number;
}

@Injectable()
export class SplitTokenSigner {
  private readonly logger = new Logger(SplitTokenSigner.name);
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly remote: boolean;

  constructor() {
    this.baseUrl = process.env.HIVEID_BASE_URL ?? DEFAULT_HIVEID_BASE_URL;
    this.serviceToken = process.env.HIVEID_SIGNER_TOKEN ?? '';
    this.remote = !!process.env.HIVEID_BASE_URL && this.baseUrl.trim().toLowerCase() !== 'disabled';
  }

  /** True when tokens are minted remotely via the IdP (post-cutover); false = local signing. */
  isRemote(): boolean {
    return this.remote;
  }

  async mint(jwtService: JwtService, args: SplitMintArgs): Promise<string> {
    if (!this.remote) {
      // Local signing (dev / test / pre-cutover). Output is identical to the
      // pre-Increment-4 call sites: {...claims, aud} signed with expiresIn.
      return signJwt(jwtService, { ...args.claims, aud: args.audience }, { expiresIn: args.expiresInSeconds });
    }
    return this.mintRemote(args);
  }

  private async mintRemote(args: SplitMintArgs): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/mint`, {
        method: 'POST',
        headers: { 'x-service-token': this.serviceToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ claims: args.claims, audience: args.audience, expiresIn: args.expiresInSeconds }),
      });
      if (!res.ok) throw new Error(`IdP mint rejected: HTTP ${res.status}`);
      const body = (await res.json()) as { token?: string };
      if (!body?.token) throw new Error('IdP mint returned no token');
      return body.token;
    } catch (err) {
      this.logger.error(`SPLIT ${args.audience} token mint via IdP failed: ${(err as Error).message}`);
      throw new Error('token signer unavailable');
    }
  }
}
