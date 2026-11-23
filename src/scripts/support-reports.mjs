#!/usr/bin/env node
// Credentials arrive through environment/stdin configuration, never command arguments or output.
import { readFile } from 'node:fs/promises';

const FILTERS = { scope: ['provider', 'platform'], kind: ['bug', 'suggestion'] };

export async function run(input, { env = process.env, request = fetch, read = readFile, output = console.log } = {}) {
  // `list` filters: --scope=provider|platform, --kind=bug|suggestion. Anything else is a usage error.
  const filters = {};
  const args = input.filter((arg) => {
    const match = /^--(scope|kind)=(.+)$/.exec(arg);
    if (!match) return true;
    if (!FILTERS[match[1]].includes(match[2])) throw new Error(`Unknown ${match[1]}: ${match[2]}`);
    filters[match[1]] = match[2];
    return false;
  });
  const [command, reference, file] = args;
  if (Object.keys(filters).length && command !== 'list') throw new Error('--scope and --kind apply to list only');
  if (
    !['list', 'show', 'resolve'].includes(command) ||
    (command !== 'list' && !/^[0-9a-f-]{36}$/.test(reference ?? '')) ||
    args.length > (command === 'resolve' ? 3 : 2)
  )
    throw new Error(
      'Usage: support-reports.mjs list [offset] [--scope=provider|platform] [--kind=bug|suggestion]' +
        ' | show <reference> | resolve <reference> <file or ->',
    );
  const base = new URL(env.SUPPORT_CFS_URL ?? 'http://127.0.0.1:8383');
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
    throw new Error('HTTPS required outside loopback');
  if (base.username || base.password || base.search || base.hash) throw new Error('Invalid server URL');
  const token = env.SUPPORT_ADMIN_TOKEN;
  if (!token) throw new Error('SUPPORT_ADMIN_TOKEN is required');
  let path = '/admin/support/reports';
  const options = {
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  };
  if (command === 'list')
    path += `?${new URLSearchParams({ offset: String(Number.parseInt(reference ?? '0', 10) || 0), ...filters })}`;
  else path += `/${reference}`;
  if (command === 'resolve') {
    if (!file) throw new Error('Resolution file or - is required');
    const resolution = await read(file === '-' ? '/dev/stdin' : file, 'utf8');
    if (!resolution.trim() || Buffer.byteLength(resolution) > 16_384)
      throw new Error('Resolution exceeds 16 KiB or is empty');
    path += '/resolution';
    Object.assign(options, { method: 'POST', body: JSON.stringify({ resolution }) });
  }
  const response = await request(new URL(path, base), options);
  if (!response.ok) throw new Error(`Support request refused (HTTP ${response.status})`);
  output(JSON.stringify(await response.json(), null, 2));
}
if (process.argv[1]?.endsWith('/support-reports.mjs'))
  run(process.argv.slice(2)).catch(() => {
    // Never print a transport exception that might contain credentials or report content.
    console.error('Support command failed; check arguments, authenticated session and CFS status.');
    process.exitCode = 1;
  });
