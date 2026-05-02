/**
 * Shared two-pane shell for Templates sub-views. Provides:
 *   - left catalog panel with grouped "Yours" / "Builtin" sections
 *   - right builder host
 *   - empty-state for the builder
 *   - delete-button overlay (on the builder host) for user items
 *
 * The shell knows nothing about the data shape. Each view passes a list
 * of `CatalogItem`s and a click handler.
 */
import type { CatalogItem } from './viewTypes';

export interface CatalogShellOpts {
  title: string;
  titleIcon: string;
  newButtonLabel: string;
  newButtonTitle?: string;
  onNew: () => void;
  builderEmptyHint: string;
  builderEmptyIcon: string;
}

export interface CatalogShell {
  root: HTMLElement;
  builderHost: HTMLElement;
  renderCatalog(
    items: CatalogItem[],
    selectedId: string | null,
    onSelect: (item: CatalogItem) => void,
  ): void;
  clearBuilder(): void;
  attachDeleteButton(handler: () => void): void;
  destroy(): void;
}

export function buildCatalogShell(opts: CatalogShellOpts): CatalogShell {
  const root = document.createElement('div');
  root.className = 'tpl-layout';

  // Left
  const catalogPanel = document.createElement('div');
  catalogPanel.className = 'tpl-catalog-panel';

  const catalogHeader = document.createElement('div');
  catalogHeader.className = 'tpl-catalog-header';
  catalogHeader.innerHTML = `<h3><i class="fa-solid ${opts.titleIcon}"></i> ${escapeHtml(opts.title)}</h3>`;

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'tpl-new-btn';
  newBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${escapeHtml(opts.newButtonLabel)}`;
  if (opts.newButtonTitle) newBtn.title = opts.newButtonTitle;
  newBtn.addEventListener('click', opts.onNew);
  catalogHeader.appendChild(newBtn);

  catalogPanel.appendChild(catalogHeader);

  const catalogBody = document.createElement('div');
  catalogBody.className = 'tpl-catalog-body';
  catalogPanel.appendChild(catalogBody);

  // Right
  const builderPanel = document.createElement('div');
  builderPanel.className = 'tpl-builder-panel';

  const builderHost = document.createElement('div');
  builderHost.className = 'tpl-builder-host';
  builderPanel.appendChild(builderHost);

  const emptyMessage = document.createElement('div');
  emptyMessage.className = 'tpl-builder-empty';
  emptyMessage.innerHTML = `
    <i class="fa-solid ${opts.builderEmptyIcon}"></i>
    <p>${opts.builderEmptyHint}</p>
  `;
  builderPanel.appendChild(emptyMessage);

  root.appendChild(catalogPanel);
  root.appendChild(builderPanel);

  function renderCatalog(
    items: CatalogItem[],
    selectedId: string | null,
    onSelect: (item: CatalogItem) => void,
  ): void {
    catalogBody.innerHTML = '';

    const userItems = items.filter((i) => i.source === 'user');
    const builtinItems = items.filter((i) => i.source === 'builtin');

    if (userItems.length) {
      appendSection(catalogBody, 'Yours', userItems, selectedId, onSelect);
    } else {
      const emptyHint = document.createElement('div');
      emptyHint.className = 'tpl-catalog-empty-hint';
      emptyHint.textContent = "You haven't saved any items yet.";
      catalogBody.appendChild(emptyHint);
    }
    if (builtinItems.length) {
      appendSection(catalogBody, 'Builtin', builtinItems, selectedId, onSelect);
    }
  }

  function clearBuilder(): void {
    while (builderHost.firstChild) builderHost.removeChild(builderHost.firstChild);
    emptyMessage.style.display = '';
  }

  function attachDeleteButton(handler: () => void): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tpl-delete-btn';
    btn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    btn.addEventListener('click', handler);
    builderHost.appendChild(btn);
    emptyMessage.style.display = 'none';
  }

  function destroy(): void {
    while (root.firstChild) root.removeChild(root.firstChild);
    root.remove();
  }

  // Anything appended into builderHost by the view itself implies we
  // have content, so hide the empty message. Views that mount their
  // own controls call into this via the hook below.
  const observer = new MutationObserver(() => {
    if (builderHost.children.length > 0) emptyMessage.style.display = 'none';
    else emptyMessage.style.display = '';
  });
  observer.observe(builderHost, { childList: true });

  return {
    root,
    builderHost,
    renderCatalog,
    clearBuilder,
    attachDeleteButton,
    destroy: () => {
      observer.disconnect();
      destroy();
    },
  };
}

function appendSection(
  parent: HTMLElement,
  label: string,
  items: CatalogItem[],
  selectedId: string | null,
  onSelect: (item: CatalogItem) => void,
): void {
  const heading = document.createElement('div');
  heading.className = 'tpl-catalog-section';
  heading.textContent = label;
  parent.appendChild(heading);

  for (const item of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tpl-catalog-card';
    if (item.id === selectedId) card.classList.add('is-selected');
    card.dataset.itemId = item.id;
    card.dataset.source = item.source;

    if (item.source === 'builtin') {
      const marker = document.createElement('span');
      marker.className = 'tpl-catalog-card__marker';
      marker.title = 'Builtin (read-only — fork to customize)';
      marker.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
      marker.setAttribute('aria-label', 'Builtin');
      card.appendChild(marker);
    }

    const name = document.createElement('div');
    name.className = 'tpl-catalog-card__name';
    name.textContent = item.name;
    card.appendChild(name);

    if (item.description) {
      const desc = document.createElement('div');
      desc.className = 'tpl-catalog-card__desc';
      desc.textContent = item.description;
      card.appendChild(desc);
    }

    card.addEventListener('click', () => onSelect(item));
    parent.appendChild(card);
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
