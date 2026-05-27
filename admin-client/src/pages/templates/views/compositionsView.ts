/**
 * Templates → Compositions view. Two-pane: catalog (left) + the
 * `createCompositionEditor` from courthive-components (right).
 *
 * Compositions don't have ecosystem builtins the way topologies do
 * (`standardTemplates`), so the catalog only shows user items. A "New"
 * button mounts an empty editor; saving via the editor's `onSave`
 * callback persists to the server catalog.
 */
import { createCompositionEditor, type SavedComposition } from 'courthive-components';
import { confirmModal, promptModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import {
  listCatalog,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  type CatalogItemDto,
} from 'services/apis/catalogApi';

import type { ProviderValue } from 'types/tmx';
import type { ViewMount, CatalogItem } from './viewTypes';
import { buildCatalogShell } from './catalogShell';

interface CompositionCatalogItem extends CatalogItem {
  composition: SavedComposition;
}

export function mountCompositionsView(host: HTMLElement, provider: ProviderValue): ViewMount {
  let editorInstance: { destroy: () => void; getComposition: () => SavedComposition } | null = null;
  let userItems: CatalogItemDto[] = [];
  let selectedItemId: string | null = null;
  let destroyed = false;

  const shell = buildCatalogShell({
    title: 'Compositions',
    titleIcon: 'fa-table-cells',
    newButtonLabel: 'New',
    newButtonTitle: 'Start a fresh composition',
    onNew: () => {
      selectedItemId = null;
      rebuildCatalog();
      mountEditor(null);
    },
    builderEmptyHint: 'Pick a composition from the catalog or click <strong>New</strong>.',
    builderEmptyIcon: 'fa-arrow-left',
  });
  host.appendChild(shell.root);

  function items(): CompositionCatalogItem[] {
    return userItems.map((row) => ({
      id: row.catalogId,
      name: row.name,
      description: row.description ?? null,
      source: 'user',
      composition: row.data as SavedComposition,
    }));
  }

  function rebuildCatalog(): void {
    shell.renderCatalog(items(), selectedItemId, (item) => {
      selectedItemId = item.id;
      rebuildCatalog();
      mountEditor(item as CompositionCatalogItem);
    });
  }

  function mountEditor(item: CompositionCatalogItem | null): void {
    shell.clearBuilder();

    editorInstance = createCompositionEditor(shell.builderHost, {
      composition: item?.composition.configuration as any,
      compositionName: item?.composition.compositionName ?? '',
      onSave: (saved) => onSave(item, saved),
    });

    if (item) shell.attachDeleteButton(() => onDelete(item));
  }

  function onSave(current: CompositionCatalogItem | null, saved: SavedComposition): void {
    const proposedName = saved.compositionName?.trim() || current?.name || '';
    promptModal({
      title: current ? 'Save composition' : 'Name composition',
      label: 'Composition name:',
      defaultValue: proposedName,
      okIntent: 'is-info',
      okAction: async (raw: string) => {
        const name = raw.trim();
        if (!name) return;
        const data: SavedComposition = { ...saved, compositionName: name };
        try {
          if (current) {
            await updateCatalogItem(provider.organisationId, 'composition', current.id, { name, data });
            tmxToast({ message: `Saved "${name}"`, intent: 'is-success' });
          } else {
            await createCatalogItem(provider.organisationId, 'composition', { name, data });
            tmxToast({ message: `Created "${name}"`, intent: 'is-success' });
          }
          await refresh();
        } catch {
          tmxToast({ message: 'Failed to save composition', intent: 'is-danger' });
        }
      },
    });
  }

  function onDelete(item: CompositionCatalogItem): void {
    confirmModal({
      title: 'Delete composition',
      query: `Delete composition "${item.name}"?`,
      okIntent: 'is-danger',
      okAction: async () => {
        try {
          await deleteCatalogItem(provider.organisationId, 'composition', item.id);
          selectedItemId = null;
          shell.clearBuilder();
          await refresh();
          tmxToast({ message: `Deleted "${item.name}"`, intent: 'is-success' });
        } catch {
          tmxToast({ message: 'Failed to delete composition', intent: 'is-danger' });
        }
      },
    });
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    const res: any = await listCatalog(provider.organisationId, 'composition');
    userItems = res?.data?.items ?? [];
    rebuildCatalog();
  }

  void refresh();

  return {
    destroy: () => {
      destroyed = true;
      editorInstance?.destroy();
      editorInstance = null;
      shell.destroy();
    },
  };
}
