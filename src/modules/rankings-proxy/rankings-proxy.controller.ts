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
 * Only GET is proxied today; rankings writes (POST /rankings/snapshots,
 * POST /tournaments/ingest) stay private to the rankings service.
 * Production traffic should never POST through this proxy.
 */

import { All, Controller, HttpException, HttpStatus, Logger, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

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
      const upstream = await fetch(url, { method: 'GET' });
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      res.status(upstream.status);
      res.setHeader('content-type', contentType);
      // Cache-control: stay short for live data; browsers + Cloudflare can
      // cache cheaply but a 30s window means refreshes propagate quickly.
      res.setHeader('cache-control', 'public, max-age=30, stale-while-revalidate=60');
      const body = await upstream.text();
      res.send(body);
    } catch (e: any) {
      this.logger.warn(`proxy failed for ${url}: ${e?.message ?? e}`);
      res.status(HttpStatus.BAD_GATEWAY).json({
        message: 'rankings service unreachable',
        upstream: url,
      });
    }
  }
}
