/**
 * Templates page (admin-client) — per-provider catalogs of bracket
 * topologies, tie formats, and compositions. Three sub-views switched
 * via the nav chip row at the top.
 *
 * Mirrors TMX's templates page but persists to the server (per-provider)
 * instead of IndexedDB. Topology IDs saved here are referenced by
 * `allowedDrawTypes` in `providerConfigSettings`, so the Settings panel's
 * Allowed Selections chip widget can surface provider-defined draw
 * structures alongside the factory enum.
 */
import './templatesPage.css';
import { showTMXtemplates } from 'services/transitions/screenSlaver';
import { getActiveProvider } from 'services/provider/providerState';
import { removeAllChildNodes } from 'services/dom/transformers';
import { context } from 'services/context';
import { mountTopologiesView } from './views/topologiesView';
import { mountCompositionsView } from './views/compositionsView';
import { mountTieFormatsView } from './views/tieFormatsView';

import { TMX_TEMPLATES, TEMPLATES } from 'constants/tmxConstants';

import type { ViewMount } from './views/viewTypes';

type TemplateView = 'topologies' | 'tieFormats' | 'compositions';

const VIEW_KEYS: Record<string, TemplateView> = {
  topologies: 'topologies',
  tieformats: 'tieFormats',
  compositions: 'compositions',
};

const VIEW_LIST: { key: TemplateView; label: string }[] = [
  { key: 'topologies', label: 'Topologies' },
  { key: 'tieFormats', label: 'Tie Formats' },
  { key: 'compositions', label: 'Compositions' },
];

let activeMount: ViewMount | null = null;

export async function renderTemplatesPage(params?: { templateView?: string }): Promise<void> {
  showTMXtemplates();

  const provider = getActiveProvider();
  const container = document.getElementById(TMX_TEMPLATES);
  if (!container) return;

  destroyActive();
  removeAllChildNodes(container);

  if (!provider) {
    container.appendChild(buildNoProviderPanel());
    return;
  }

  const activeView: TemplateView = params?.templateView
    ? VIEW_KEYS[params.templateView.toLowerCase()] ?? 'topologies'
    : 'topologies';

  const chipsRow = document.createElement('div');
  chipsRow.className = 'tpl-nav-chips';
  for (const view of VIEW_LIST) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tpl-nav-chip';
    if (view.key === activeView) chip.classList.add('active');
    chip.textContent = view.label;
    chip.addEventListener('click', () => {
      context.router?.navigate(`/${TEMPLATES}/${view.key.toLowerCase()}`);
    });
    chipsRow.appendChild(chip);
  }

  const viewHost = document.createElement('div');
  viewHost.className = 'tpl-view-host';

  container.appendChild(chipsRow);
  container.appendChild(viewHost);

  switch (activeView) {
    case 'topologies':
      activeMount = mountTopologiesView(viewHost, provider);
      break;
    case 'compositions':
      activeMount = mountCompositionsView(viewHost, provider);
      break;
    case 'tieFormats':
      activeMount = mountTieFormatsView(viewHost, provider);
      break;
  }
}

function destroyActive(): void {
  activeMount?.destroy();
  activeMount = null;
}

function buildNoProviderPanel(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tpl-no-provider';
  wrap.innerHTML = `
    <i class="fa-solid fa-building"></i>
    <p>Select a provider before editing templates.</p>
    <p class="tpl-no-provider-sub">Templates are scoped to a single provider; super-admins must impersonate a provider first.</p>
  `;
  return wrap;
}
