/**
 * RankingsProxyController — exposes the co-resident courthive-rankings
 * service at /api/rankings/* on courthive.net via Cloudflare → Express.
 *
 * The rankings service runs at http://localhost:3110 on nest and isn't
 * directly reachable from the public internet. Public consumers (e.g.
 * courthive-public's BOBOCA rankings page) need read access to
 * snapshots + per-person award histories without a separate NGINX
 * stanza or a custom proxy. This module is that bridge.
 *
 * No auth — matches the rankings service surface. If/when the rankings
 * service grows authenticated endpoints, they should be tagged
 * explicitly and gated here (NOT silently exposed).
 *
 * NOTE THE PREFIX REWRITE, because it decides what is reachable at all:
 * `/api/rankings/<tail>` becomes `/rankings/<tail>` upstream, so ONLY
 * controllers the rankings service mounts under `rankings` can be read
 * from the internet. Per-person ranking history was invisible for exactly
 * this reason until it was re-mounted at `rankings/person/:personId/*`
 * (see courthive-rankings PersonRankingsController). Anything new that
 * the public profile needs must be mounted under `rankings` too — adding
 * an `/api/persons/*` route here instead would collide with
 * courthive-persons, which is a different service behind the same word.
 *
 * Only GET is proxied today; rankings writes (POST /rankings/snapshots,
 * POST /tournaments/ingest) stay private to the rankings service.
 * Production traffic should never POST through this proxy.
 */

import { All, Controller, HttpException, HttpStatus, Logger, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'stream';

import { Public } from '../account/auth/decorators/public.decorator';

const RANKINGS_BASE_URL = process.env.RANKINGS_BASE_URL ?? 'http://localhost:3110';

@Controller('api/rankings')
export class RankingsProxyController {
  private readonly logger = new Logger(RankingsProxyController.name);

  // Catch-all for /api/rankings/* — forward to localhost:3110/rankings/*.
  // Splat capture works through Nest's wildcard match below; we rebuild
  // the upstream path from req.params.path[0] (Express joins extras).
  @All('*splat')
  @Public()
  async proxy(
    @Param('splat') splat: string[] | string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (req.method !== 'GET') {
      throw new HttpException(
        { message: 'Only GET is proxied via /api/rankings — writes stay on the rankings service.' },
        HttpStatus.METHOD_NOT_ALLOWED,
      );
    }

    const tail = Array.isArray(splat) ? splat.join('/') : splat;
    const upstreamPath = `/rankings/${tail}`;
    const qs = new URLSearchParams(query).toString();
    const url = `${RANKINGS_BASE_URL}${upstreamPath}${qs ? `?${qs}` : ''}`;

    try {
      // Conditional headers are forwarded so a client holding a cached
      // historical snapshot can revalidate and get a 304 with no body at all.
      const conditional: Record<string, string> = {};
      const ifNoneMatch = req.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string') conditional['if-none-match'] = ifNoneMatch;

      const upstream = await fetch(url, { method: 'GET', headers: conditional });
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      res.status(upstream.status);
      res.setHeader('content-type', contentType);

      // The rankings service knows whether what it just served is immutable;
      // this proxy does not. A snapshot for a past date never changes and is
      // sent with a one-year immutable TTL, while a live bundle is seconds
      // old — so the upstream's opinion wins when it has one, and the short
      // window remains the default for everything that does not set it.
      res.setHeader('cache-control', upstream.headers.get('cache-control') ?? 'public, max-age=30, stale-while-revalidate=60');
      const etag = upstream.headers.get('etag');
      if (etag) res.setHeader('etag', etag);

      if (upstream.status === HttpStatus.NOT_MODIFIED || !upstream.body) {
        res.end();
        return;
      }

      // STREAMED, NOT BUFFERED. `await upstream.text()` materialised the whole
      // body as a string in THIS process — the mutation server — before writing
      // a byte. A ranking list is ~8 MB of JSON at USTA scale, on a @Public()
      // route, so every anonymous reader was a heap event in the process that
      // also serves tournament mutations.
      await new Promise<void>((resolve, reject) => {
        Readable.fromWeb(upstream.body as any)
          .on('error', reject)
          .on('end', resolve)
          .pipe(res);
      });
    } catch (e: any) {
      this.logger.warn(`proxy failed for ${url}: ${e?.message ?? e}`);
      res.status(HttpStatus.BAD_GATEWAY).json({
        message: 'rankings service unreachable',
        upstream: url,
      });
    }
  }
}
