/**
 * Templates → Tie Formats view. Two-pane: catalog (left) + JSON editor (right).
 *
 * `courthive-components` does not currently export a tieFormat editor —
 * TMX uses its own `editTieFormat` overlay. Until that's ported into
 * courthive-components (separate workstream), this view ships a JSON
 * editor: name + description + JSON body. Round-trip through the same
 * generic catalog endpoint as compositions.
 */
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

interface TieFormatCatalogItem extends CatalogItem {
  tieFormat: any;
}

export function mountTieFormatsView(host: HTMLElement, provider: ProviderValue): ViewMount {
  let userItems: CatalogItemDto[] = [];
  let selectedItemId: string | null = null;
  let destroyed = false;

  const shell = buildCatalogShell({
    title: 'Tie Formats',
    titleIcon: 'fa-people-arrows',
    newButtonLabel: 'New',
    newButtonTitle: 'Start a fresh tie format',
    onNew: () => {
      selectedItemId = null;
      rebuildCatalog();
      mountEditor(null);
    },
    builderEmptyHint: 'Pick a tie format from the catalog or click <strong>New</strong>.',
    builderEmptyIcon: 'fa-arrow-left',
  });
  host.appendChild(shell.root);

  function items(): TieFormatCatalogItem[] {
    return userItems.map((row) => ({
      id: row.catalogId,
      name: row.name,
      description: row.description ?? null,
      source: 'user',
      tieFormat: row.data,
    }));
  }

  function rebuildCatalog(): void {
    shell.renderCatalog(items(), selectedItemId, (item) => {
      selectedItemId = item.id;
      rebuildCatalog();
      mountEditor(item as TieFormatCatalogItem);
    });
  }

  function mountEditor(item: TieFormatCatalogItem | null): void {
    shell.clearBuilder();
    const editor = buildTieFormatEditor({
      initialName: item?.name ?? '',
      initialDescription: item?.description ?? '',
      initialJson: item ? JSON.stringify(item.tieFormat, null, 2) : '',
      onSave: (payload) => void onSave(item, payload),
    });
    shell.builderHost.appendChild(editor);

    if (item) shell.attachDeleteButton(() => void onDelete(item));
  }

  async function onSave(
    current: TieFormatCatalogItem | null,
    payload: { name: string; description: string; data: any },
  ): Promise<void> {
    try {
      if (current) {
        await updateCatalogItem(provider.organisationId, 'tieFormat', current.id, payload);
        tmxToast({ message: `Saved "${payload.name}"`, intent: 'is-success' });
      } else {
        await createCatalogItem(provider.organisationId, 'tieFormat', payload);
        tmxToast({ message: `Created "${payload.name}"`, intent: 'is-success' });
      }
      await refresh();
    } catch {
      tmxToast({ message: 'Failed to save tie format', intent: 'is-danger' });
    }
  }

  async function onDelete(item: TieFormatCatalogItem): Promise<void> {
    if (!window.confirm(`Delete tie format "${item.name}"?`)) return;
    try {
      await deleteCatalogItem(provider.organisationId, 'tieFormat', item.id);
      selectedItemId = null;
      shell.clearBuilder();
      await refresh();
      tmxToast({ message: `Deleted "${item.name}"`, intent: 'is-success' });
    } catch {
      tmxToast({ message: 'Failed to delete tie format', intent: 'is-danger' });
    }
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    const res: any = await listCatalog(provider.organisationId, 'tieFormat');
    userItems = res?.data?.items ?? [];
    rebuildCatalog();
  }

  void refresh();

  return {
    destroy: () => {
      destroyed = true;
      shell.destroy();
    },
  };
}

interface JsonEditorOpts {
  initialName: string;
  initialDescription: string;
  initialJson: string;
  onSave: (payload: { name: string; description: string; data: any }) => void;
}

function buildTieFormatEditor(opts: JsonEditorOpts): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tpl-json-editor';

  const nameRow = document.createElement('label');
  nameRow.className = 'sp-field';
  nameRow.innerHTML = '<span class="sp-field-label">Name</span>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'sp-field-input';
  nameInput.value = opts.initialName;
  nameInput.placeholder = 'e.g. ITF Davis Cup';
  nameRow.appendChild(nameInput);
  wrap.appendChild(nameRow);

  const descRow = document.createElement('label');
  descRow.className = 'sp-field';
  descRow.innerHTML = '<span class="sp-field-label">Description</span>';
  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'sp-field-input';
  descInput.value = opts.initialDescription;
  descInput.placeholder = 'Optional';
  descRow.appendChild(descInput);
  wrap.appendChild(descRow);

  const jsonRow = document.createElement('label');
  jsonRow.className = 'sp-field';
  jsonRow.innerHTML = '<span class="sp-field-label">Tie Format (JSON)</span>';
  const ta = document.createElement('textarea');
  ta.className = 'tpl-json-textarea';
  ta.rows = 18;
  ta.spellcheck = false;
  ta.value = opts.initialJson;
  ta.placeholder = '{\n  "collectionDefinitions": [...]\n}';
  jsonRow.appendChild(ta);
  wrap.appendChild(jsonRow);

  const error = document.createElement('div');
  error.className = 'tpl-json-error';
  error.style.display = 'none';
  wrap.appendChild(error);

  const actions = document.createElement('div');
  actions.className = 'tpl-json-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'tpl-save-btn';
  saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      showError('Name is required.');
      return;
    }
    let parsed: any;
    try {
      parsed = ta.value.trim() ? JSON.parse(ta.value) : {};
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Invalid JSON.');
      return;
    }
    error.style.display = 'none';
    opts.onSave({ name, description: descInput.value.trim(), data: parsed });
  });
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);

  function showError(msg: string): void {
    error.textContent = msg;
    error.style.display = '';
  }

  return wrap;
}
