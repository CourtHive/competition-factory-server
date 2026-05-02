/**
 * Policies page (admin-client) — per-provider policy catalog.
 *
 * Mirrors TMX's policies page but persists to the server (per-provider)
 * via the generic catalog endpoint. The heavy lifting is the
 * `createPolicyCatalog` component from courthive-components, which owns
 * the catalog UI, search, grouping, and per-policy-type editors. We
 * just feed it builtin + user policies and respond to its callbacks.
 *
 * Per-provider policies stored here can later be referenced from the
 * provider Settings panel's Policies topic, replacing the current
 * raw-JSON paste editor with a picker over the available catalog.
 */
import './policiesPage.css';
import { createPolicyCatalog, type PolicyCatalogItem } from 'courthive-components';
import { showTMXpolicies } from 'services/transitions/screenSlaver';
import { getActiveProvider } from 'services/provider/providerState';
import { removeAllChildNodes } from 'services/dom/transformers';
import { tmxToast } from 'services/notifications/tmxToast';
import {
  listCatalog,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  type CatalogItemDto,
} from 'services/apis/catalogApi';
import { BUILTIN_POLICIES } from './policyBridge';

import { TMX_POLICIES } from 'constants/tmxConstants';

let activeControl: { destroy?: () => void } | null = null;

export async function renderPoliciesPage(): Promise<void> {
  showTMXpolicies();

  const provider = getActiveProvider();
  const container = document.getElementById(TMX_POLICIES);
  if (!container) return;

  destroyActive();
  removeAllChildNodes(container);

  if (!provider) {
    container.appendChild(buildNoProviderPanel());
    return;
  }

  const userPolicies = await loadUserPolicies(provider.organisationId);

  const host = document.createElement('div');
  host.className = 'pol-host';
  container.appendChild(host);

  const control = createPolicyCatalog(
    {
      builtinPolicies: BUILTIN_POLICIES,
      userPolicies,
      onPolicyCreated: (item) => void onCreate(provider.organisationId, item),
      onPolicySaved: (item) => void onSave(provider.organisationId, item),
      onPolicyDeleted: (id) => void onDelete(provider.organisationId, id),
    },
    host,
  );
  activeControl = control as any;
}

async function loadUserPolicies(providerId: string): Promise<PolicyCatalogItem[]> {
  try {
    const res: any = await listCatalog(providerId, 'policy');
    const rows = (res?.data?.items ?? []) as CatalogItemDto[];
    return rows.map(rowToCatalogItem);
  } catch {
    tmxToast({ message: 'Failed to load policies', intent: 'is-danger' });
    return [];
  }
}

function rowToCatalogItem(row: CatalogItemDto): PolicyCatalogItem {
  const meta = (row.metadata ?? {}) as { policyType?: string; description?: string };
  return {
    id: row.catalogId,
    name: row.name,
    policyType: meta.policyType ?? 'unknown',
    source: 'user',
    description: row.description ?? meta.description ?? '',
    policyData: row.data as Record<string, unknown>,
  };
}

async function onCreate(providerId: string, item: PolicyCatalogItem): Promise<void> {
  try {
    await createCatalogItem(providerId, 'policy', {
      name: item.name,
      description: item.description,
      data: item.policyData,
      metadata: { policyType: item.policyType },
    });
    tmxToast({ message: `Created "${item.name}"`, intent: 'is-success' });
  } catch {
    tmxToast({ message: 'Failed to create policy', intent: 'is-danger' });
  }
}

async function onSave(providerId: string, item: PolicyCatalogItem): Promise<void> {
  // PolicyCatalog emits onPolicySaved for both renames and content edits
  // on user items. Builtins are read-only; their `id` starts with
  // `builtin-`, so guard against accidentally writing them.
  if (item.source === 'builtin' || item.id.startsWith('builtin-')) return;
  try {
    await updateCatalogItem(providerId, 'policy', item.id, {
      name: item.name,
      description: item.description,
      data: item.policyData,
      metadata: { policyType: item.policyType },
    });
    tmxToast({ message: `Saved "${item.name}"`, intent: 'is-success' });
  } catch {
    tmxToast({ message: 'Failed to save policy', intent: 'is-danger' });
  }
}

async function onDelete(providerId: string, id: string): Promise<void> {
  if (id.startsWith('builtin-')) return;
  try {
    await deleteCatalogItem(providerId, 'policy', id);
    tmxToast({ message: 'Deleted policy', intent: 'is-success' });
  } catch {
    tmxToast({ message: 'Failed to delete policy', intent: 'is-danger' });
  }
}

function destroyActive(): void {
  activeControl?.destroy?.();
  activeControl = null;
}

function buildNoProviderPanel(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pol-no-provider';
  wrap.innerHTML = `
    <i class="fa-solid fa-building"></i>
    <p>Select a provider before editing policies.</p>
    <p class="pol-no-provider-sub">Policies are scoped to a single provider; super-admins must impersonate a provider first.</p>
  `;
  return wrap;
}
