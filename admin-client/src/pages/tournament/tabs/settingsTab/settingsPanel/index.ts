/**
 * Provider settings panel — full-width in-page editor that replaces the
 * old Quick Actions → Edit Settings modal. Two-column layout: topic nav
 * on the left, structured editor on the right. Persists to
 * `providerConfigSettings` via the existing `updateProviderSettings`
 * API.
 *
 * Phase 1: layout + topic nav skeleton with placeholder topic content.
 * Per-topic editors and save plumbing land in subsequent phases — see
 * `Mentat/planning/ADMIN_SETTINGS_PAGE_REDESIGN.md`.
 */
import './settingsPanel.css';
import type { ProviderValue } from 'types/tmx';

export interface SettingsPanelTopic {
  id: string;
  label: string;
  icon: string;
}

const TOPICS: SettingsPanelTopic[] = [
  { id: 'permissions', label: 'Permissions', icon: 'fa-shield-halved' },
  { id: 'allowed', label: 'Allowed Universes', icon: 'fa-list-check' },
  { id: 'policies', label: 'Policies', icon: 'fa-scale-balanced' },
  { id: 'defaults', label: 'Defaults', icon: 'fa-sliders' },
  { id: 'print', label: 'Print Configuration', icon: 'fa-print' },
  { id: 'categories', label: 'Categories', icon: 'fa-layer-group' },
];

interface RenderSettingsPanelParams {
  provider: ProviderValue;
  isSuperAdmin?: boolean;
}

export function renderSettingsPanel(grid: HTMLElement, params: RenderSettingsPanelParams): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-gray sp-panel';
  panel.style.gridColumn = '1 / -1';
  // Stash provider context on the panel so per-topic editors mounted
  // later can read it without prop-drilling.
  panel.dataset.providerId = params.provider.organisationId;
  if (params.isSuperAdmin) panel.dataset.superAdmin = 'true';

  const header = document.createElement('h3');
  header.innerHTML = '<i class="fa-solid fa-sliders"></i> Settings';
  panel.appendChild(header);

  const layout = document.createElement('div');
  layout.className = 'sp-layout';

  layout.appendChild(buildNav());
  layout.appendChild(buildContent());

  panel.appendChild(layout);
  grid.appendChild(panel);
}

function buildNav(): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'sp-nav';
  nav.setAttribute('aria-label', 'Settings topics');

  let activeId = TOPICS[0].id;

  for (const topic of TOPICS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sp-nav-item';
    item.dataset.topic = topic.id;
    item.setAttribute('aria-pressed', String(topic.id === activeId));
    if (topic.id === activeId) item.classList.add('is-active');
    item.innerHTML = `<i class="fa-solid ${topic.icon}"></i><span>${topic.label}</span>`;
    item.addEventListener('click', () => {
      activeId = topic.id;
      nav.querySelectorAll<HTMLButtonElement>('.sp-nav-item').forEach((btn) => {
        const isActive = btn.dataset.topic === activeId;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
      });
      const event = new CustomEvent('sp:topic-change', { detail: activeId, bubbles: true });
      nav.dispatchEvent(event);
    });
    nav.appendChild(item);
  }

  return nav;
}

function buildContent(): HTMLElement {
  const content = document.createElement('div');
  content.className = 'sp-content';
  content.setAttribute('aria-live', 'polite');

  const placeholder = document.createElement('div');
  placeholder.className = 'sp-placeholder';
  placeholder.innerHTML = `
    <i class="fa-solid fa-wrench"></i>
    <p>Settings editors are being rebuilt.</p>
    <p class="sp-placeholder-sub">Per-topic structured forms land in the next phases — see the admin-client settings redesign plan for details.</p>
  `;
  content.appendChild(placeholder);

  return content;
}
