/**
 * Templates → Topologies view. Two-pane: catalog (left) + builder (right).
 * Persists to the server's per-provider topology catalog.
 *
 * Topology IDs saved here are referenced by `allowedDrawTypes` in
 * `providerConfigSettings`, so the Settings panel's Allowed Selections
 * chip widget can surface provider-defined draw structures alongside
 * the factory enum.
 */
import { TopologyBuilderControl, standardTemplates } from 'courthive-components';
import { tmxToast } from 'services/notifications/tmxToast';
import {
  listTopologies,
  createTopology,
  updateTopology,
  deleteTopology,
  type TopologyDto,
} from 'services/apis/topologyApi';

import type { TopologyState, TopologyTemplate } from 'courthive-components';
import type { ProviderValue } from 'types/tmx';
import type { ViewMount, CatalogItem } from './viewTypes';
import { buildCatalogShell } from './catalogShell';

interface TopologyCatalogItem extends CatalogItem {
  state: TopologyTemplate['state'];
}

export function mountTopologiesView(host: HTMLElement, provider: ProviderValue): ViewMount {
  let builderControl: TopologyBuilderControl | null = null;
  let userTopologies: TopologyDto[] = [];
  let selectedItemId: string | null = null;
  let destroyed = false;

  const shell = buildCatalogShell({
    title: 'Topologies',
    titleIcon: 'fa-shapes',
    newButtonLabel: 'New',
    newButtonTitle: 'Start a fresh topology',
    onNew: () => {
      selectedItemId = null;
      rebuildCatalog();
      mountBuilder(null);
    },
    builderEmptyHint: 'Pick a topology from the catalog or click <strong>New</strong>.',
    builderEmptyIcon: 'fa-arrow-left',
  });
  host.appendChild(shell.root);

  function items(): TopologyCatalogItem[] {
    const userItems: TopologyCatalogItem[] = userTopologies.map((t) => ({
      id: t.topologyId,
      name: t.name,
      description: t.description ?? null,
      source: 'user',
      state: t.state,
    }));
    const builtinItems: TopologyCatalogItem[] = standardTemplates.map((t, i) => ({
      id: `builtin-${i}`,
      name: t.name,
      description: t.description,
      source: 'builtin',
      state: t.state,
    }));
    return [...userItems, ...builtinItems];
  }

  function rebuildCatalog(): void {
    shell.renderCatalog(items(), selectedItemId, (item) => {
      selectedItemId = item.id;
      rebuildCatalog();
      mountBuilder(item as TopologyCatalogItem);
    });
  }

  function mountBuilder(item: TopologyCatalogItem | null): void {
    shell.clearBuilder();
    const isBuiltin = item?.source === 'builtin';
    const initialState = item ? { ...item.state, templateName: item.name } : undefined;

    builderControl = new TopologyBuilderControl({
      initialState,
      hideGenerate: true,
      onSaveTemplate: (state) => void onSave(item, state, isBuiltin),
      onClear: () => {
        selectedItemId = null;
        shell.clearBuilder();
        rebuildCatalog();
      },
    });
    builderControl.render(shell.builderHost);

    if (item && item.source === 'user') {
      shell.attachDeleteButton(() => void onDelete(item));
    }
  }

  async function onSave(
    current: TopologyCatalogItem | null,
    state: TopologyState,
    isBuiltin: boolean,
  ): Promise<void> {
    const proposedName = state.templateName?.trim() || current?.name || '';
    const name = window.prompt('Topology name:', proposedName);
    if (!name) return;
    const persistedState = { ...state, selectedNodeId: null, selectedEdgeId: null };
    try {
      if (current && current.source === 'user') {
        await updateTopology(provider.organisationId, current.id, { name, state: persistedState });
        tmxToast({ message: `Saved "${name}"`, intent: 'is-success' });
      } else {
        await createTopology(provider.organisationId, { name, state: persistedState });
        tmxToast({
          message: isBuiltin ? `Forked builtin to "${name}"` : `Saved "${name}"`,
          intent: 'is-success',
        });
      }
      await refresh();
    } catch {
      tmxToast({ message: 'Failed to save topology', intent: 'is-danger' });
    }
  }

  async function onDelete(item: TopologyCatalogItem): Promise<void> {
    if (!window.confirm(`Delete topology "${item.name}"?`)) return;
    try {
      await deleteTopology(provider.organisationId, item.id);
      selectedItemId = null;
      shell.clearBuilder();
      await refresh();
      tmxToast({ message: `Deleted "${item.name}"`, intent: 'is-success' });
    } catch {
      tmxToast({ message: 'Failed to delete topology', intent: 'is-danger' });
    }
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    const res: any = await listTopologies(provider.organisationId);
    userTopologies = res?.data?.topologies ?? [];
    rebuildCatalog();
  }

  void refresh();

  return {
    destroy: () => {
      destroyed = true;
      builderControl?.destroy();
      builderControl = null;
      shell.destroy();
    },
  };
}
