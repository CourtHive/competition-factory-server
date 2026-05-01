/**
 * Topic registry for the Settings panel. Each topic owns a chunk of
 * `providerConfigSettings` and renders into the right-hand content
 * column when the user picks it from the nav.
 *
 * Phase 2 ships read-only summaries per topic so the wiring (fetch →
 * state → render per-topic) is exercised end-to-end. Phase 3 swaps
 * each topic's `render` for an actual editor.
 */
import type { ProviderConfigCaps, ProviderConfigSettings } from 'types/providerConfig';

export type TopicId = 'permissions' | 'allowed' | 'policies' | 'defaults' | 'print' | 'categories';

export interface TopicContext {
  caps: ProviderConfigCaps;
  settings: ProviderConfigSettings;
}

export interface TopicDescriptor {
  id: TopicId;
  label: string;
  icon: string;
  /** Render the topic content into the supplied host element. */
  render: (host: HTMLElement, ctx: TopicContext) => void;
}

export const TOPICS: TopicDescriptor[] = [
  { id: 'permissions', label: 'Permissions', icon: 'fa-shield-halved', render: renderPermissions },
  { id: 'allowed', label: 'Allowed Selections', icon: 'fa-list-check', render: renderAllowed },
  { id: 'policies', label: 'Policies', icon: 'fa-scale-balanced', render: renderPolicies },
  { id: 'defaults', label: 'Defaults', icon: 'fa-sliders', render: renderDefaults },
  { id: 'print', label: 'Print Configuration', icon: 'fa-print', render: renderPrint },
  { id: 'categories', label: 'Categories', icon: 'fa-layer-group', render: renderCategories },
];

// ── Topic renderers (Phase 2: read-only summaries) ─────────────────────────

function renderPermissions(host: HTMLElement, ctx: TopicContext): void {
  const set = ctx.settings.permissions ?? {};
  const setKeys = Object.keys(set).filter((k) => typeof (set as any)[k] === 'boolean');
  const summary = setKeys.length
    ? setKeys.map((k) => `<li><code>${k}</code>: <strong>${(set as any)[k] ? 'allowed' : 'denied'}</strong></li>`).join('')
    : '<li><em>No explicit permission overrides — defaults apply.</em></li>';
  host.appendChild(
    topicShell(
      'Permissions',
      'Booleans the provider has set for tournament directors. Empty = the provisioner cap is the only restriction.',
      `<ul class="sp-summary-list">${summary}</ul>`,
    ),
  );
}

function renderAllowed(host: HTMLElement, ctx: TopicContext): void {
  const perm = ctx.settings.permissions ?? {};
  const pol = ctx.settings.policies ?? {};
  const rows: string[] = [];
  const add = (label: string, list: string[] | undefined) => {
    if (!list || !list.length) return;
    rows.push(`<li><strong>${label}:</strong> ${list.map((v) => `<code>${v}</code>`).join(' ')}</li>`);
  };
  add('Draw Types', perm.allowedDrawTypes);
  add('Creation Methods', perm.allowedCreationMethods);
  add('Scoring Approaches', perm.allowedScoringApproaches);
  add('MatchUp Formats', pol.allowedMatchUpFormats);
  host.appendChild(
    topicShell(
      'Allowed Selections',
      'Narrowing within the provisioner-allowed universe. Empty list = inherit caps unchanged.',
      rows.length
        ? `<ul class="sp-summary-list">${rows.join('')}</ul>`
        : '<p class="sp-summary-empty"><em>No narrowing applied — inheriting all caps.</em></p>',
    ),
  );
}

function renderPolicies(host: HTMLElement, ctx: TopicContext): void {
  const pol = ctx.settings.policies ?? {};
  const has = (v: any) => v !== undefined && v !== null && Object.keys(v ?? {}).length > 0;
  const rows = [
    { label: 'Scheduling Policy', set: has(pol.schedulingPolicy) },
    { label: 'Scoring Policy', set: has(pol.scoringPolicy) },
    { label: 'Seeding Policy', set: has(pol.seedingPolicy) },
  ];
  host.appendChild(
    topicShell(
      'Policies',
      'Static configuration the factory engines consume. Phase 3 introduces structured editors per policy type.',
      `<ul class="sp-summary-list">${rows
        .map((r) => `<li><strong>${r.label}:</strong> ${r.set ? 'configured' : '<em>using defaults</em>'}</li>`)
        .join('')}</ul>`,
    ),
  );
}

function renderDefaults(host: HTMLElement, ctx: TopicContext): void {
  const d = ctx.settings.defaults ?? {};
  const fields: { label: string; value?: string }[] = [
    { label: 'Default Event Type', value: d.defaultEventType },
    { label: 'Default Draw Type', value: d.defaultDrawType },
    { label: 'Default Creation Method', value: d.defaultCreationMethod },
    { label: 'Default Gender', value: d.defaultGender },
  ];
  host.appendChild(
    topicShell(
      'Defaults',
      'Pre-fill values for new tournament/event/draw creation flows.',
      `<ul class="sp-summary-list">${fields
        .map((f) => `<li><strong>${f.label}:</strong> ${f.value ? `<code>${f.value}</code>` : '<em>not set</em>'}</li>`)
        .join('')}</ul>`,
    ),
  );
}

function renderPrint(host: HTMLElement, ctx: TopicContext): void {
  const printPolicies = (ctx.settings.policies as any)?.printPolicies ?? {};
  const types = ['draw', 'schedule', 'playerList', 'courtCard', 'signInSheet', 'matchCard'];
  const rows = types
    .map((t) => {
      const cfg = printPolicies[t];
      const configured = cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0;
      return `<li>${configured ? '●' : '○'} <code>${t}</code> ${configured ? '' : '<em>(uses pdf-factory defaults)</em>'}</li>`;
    })
    .join('');
  host.appendChild(
    topicShell(
      'Print Configuration',
      'Per-print-type composition policies. Phase 3 embeds the courthive-components composition editor here.',
      `<ul class="sp-summary-list">${rows}</ul>`,
    ),
  );
}

function renderCategories(host: HTMLElement, ctx: TopicContext): void {
  const cats = ctx.settings.policies?.allowedCategories ?? [];
  const rows = cats.length
    ? cats
        .map(
          (c) =>
            `<li><code>${c.ageCategoryCode}</code>${c.categoryName ? ` — ${c.categoryName}` : ''}</li>`,
        )
        .join('')
    : '<li><em>No categories restricted — all caps-allowed categories available.</em></li>';
  host.appendChild(
    topicShell(
      'Categories',
      'Restrict event categories to this list. Phase 3 introduces a row editor for adding/removing.',
      `<ul class="sp-summary-list">${rows}</ul>`,
    ),
  );
}

// ── Shared shell for a topic's content ─────────────────────────────────────

function topicShell(title: string, description: string, body: string): HTMLElement {
  const root = document.createElement('section');
  root.className = 'sp-topic';
  root.innerHTML = `
    <header class="sp-topic-header">
      <h4>${title}</h4>
      <p class="sp-topic-description">${description}</p>
    </header>
    <div class="sp-topic-body">${body}</div>
  `;
  return root;
}
