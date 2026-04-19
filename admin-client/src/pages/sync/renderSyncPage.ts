import { listRemoteTournaments, pullTournament, getSyncStatus } from 'services/apis/syncApi';
import { showTMXsync } from 'services/transitions/screenSlaver';
import { removeAllChildNodes } from 'services/dom/transformers';
import { tmxToast } from 'services/notifications/tmxToast';

import { TMX_SYNC } from 'constants/tmxConstants';

export function renderSyncPage(): void {
  showTMXsync();

  const container = document.getElementById(TMX_SYNC);
  if (!container) return;
  removeAllChildNodes(container);

  container.style.padding = '1.5em';
  container.style.gap = '1.5em';

  // Header
  const header = document.createElement('h2');
  header.textContent = 'Tournament Sync';
  header.style.margin = '0';
  container.appendChild(header);

  // Sync status section
  const statusSection = createSection('Sync Status');
  const statusTable = document.createElement('div');
  statusTable.id = 'syncStatusTable';
  statusSection.appendChild(statusTable);
  container.appendChild(statusSection);

  // Remote tournaments section
  const remoteSection = createSection('Remote Tournaments');
  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh';
  refreshBtn.className = 'button is-small';
  refreshBtn.style.marginBottom = '0.5em';
  remoteSection.insertBefore(refreshBtn, remoteSection.lastChild);

  const remoteTable = document.createElement('div');
  remoteTable.id = 'remoteTournamentsTable';
  remoteSection.appendChild(remoteTable);
  container.appendChild(remoteSection);

  // Load data
  loadSyncStatus();
  refreshBtn.addEventListener('click', () => loadRemoteTournaments());
  loadRemoteTournaments();
}

function createSection(title: string): HTMLElement {
  const section = document.createElement('div');
  section.style.display = 'flex';
  section.style.flexDirection = 'column';

  const heading = document.createElement('h3');
  heading.textContent = title;
  heading.style.margin = '0 0 0.5em 0';
  section.appendChild(heading);

  return section;
}

async function loadSyncStatus(): Promise<void> {
  const container = document.getElementById('syncStatusTable');
  if (!container) return;

  const result = await getSyncStatus();
  if (!result?.success) {
    container.textContent = result?.error ?? 'Failed to load sync status';
    return;
  }

  const statuses = result.syncStatus ?? [];
  if (statuses.length === 0) {
    container.textContent = 'No tournaments synced yet.';
    return;
  }

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.innerHTML = `
    <thead>
      <tr style="text-align: left; border-bottom: 1px solid var(--tmx-border, #ccc);">
        <th style="padding: 0.4em">Tournament</th>
        <th style="padding: 0.4em">ID</th>
        <th style="padding: 0.4em">Last Synced</th>
        <th style="padding: 0.4em">Source</th>
      </tr>
    </thead>
    <tbody>
      ${statuses.map((s: any) => `
        <tr style="border-bottom: 1px solid var(--tmx-border, #eee);">
          <td style="padding: 0.4em">${s.tournamentName ?? '—'}</td>
          <td style="padding: 0.4em; font-family: monospace; font-size: 0.85em">${s.tournamentId}</td>
          <td style="padding: 0.4em">${new Date(s.lastSyncedAt).toLocaleString()}</td>
          <td style="padding: 0.4em; font-size: 0.85em">${s.source}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  removeAllChildNodes(container);
  container.appendChild(table);
}

async function loadRemoteTournaments(): Promise<void> {
  const container = document.getElementById('remoteTournamentsTable');
  if (!container) return;

  container.textContent = 'Loading...';

  const result = await listRemoteTournaments();
  if (!result?.success) {
    container.textContent = result?.error ?? 'Failed to load remote tournaments. Check UPSTREAM_SERVER_URL.';
    return;
  }

  const ids: string[] = result.tournamentIds ?? [];
  if (ids.length === 0) {
    container.textContent = 'No tournaments found on upstream server.';
    return;
  }

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.innerHTML = `
    <thead>
      <tr style="text-align: left; border-bottom: 1px solid var(--tmx-border, #ccc);">
        <th style="padding: 0.4em">Tournament ID</th>
        <th style="padding: 0.4em; width: 100px;">Action</th>
      </tr>
    </thead>
    <tbody>
      ${ids.map((id: string) => `
        <tr style="border-bottom: 1px solid var(--tmx-border, #eee);">
          <td style="padding: 0.4em; font-family: monospace;">${id}</td>
          <td style="padding: 0.4em">
            <button class="button is-small pull-btn" data-tournament-id="${id}">Pull</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  removeAllChildNodes(container);
  container.appendChild(table);

  // Wire pull buttons
  table.querySelectorAll('.pull-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const tournamentId = target.dataset.tournamentId;
      if (!tournamentId) return;

      target.disabled = true;
      target.textContent = 'Pulling...';

      const pullResult = await pullTournament(tournamentId);
      if (pullResult?.success) {
        target.textContent = 'Done';
        tmxToast({ message: `Pulled: ${pullResult.tournamentName ?? tournamentId}`, intent: 'is-success' });
        loadSyncStatus();
      } else {
        target.textContent = 'Failed';
        target.disabled = false;
        tmxToast({ message: pullResult?.error ?? 'Pull failed', intent: 'is-danger' });
      }
    });
  });
}
