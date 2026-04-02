import { showTMXsanctioning } from 'services/transitions/screenSlaver';
import { removeAllChildNodes } from 'services/dom/transformers';
import { statusBadgeFormatter } from './components/statusBadge';
import { getSanctioningRecords } from 'services/apis/sanctioningApi';
import { tmxToast } from 'services/notifications/tmxToast';
import { context } from 'services/context';
import { TabulatorFull as Tabulator } from 'tabulator-tables';

import { TMX_SANCTIONING, SANCTIONING } from 'constants/tmxConstants';

export function renderSanctioningDashboard(): void {
  showTMXsanctioning();

  const container = document.getElementById(TMX_SANCTIONING);
  if (!container) return;
  removeAllChildNodes(container);

  // Header bar
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 16px 20px 8px;';

  const title = document.createElement('h2');
  title.textContent = 'Sanctioning Applications';
  title.style.cssText = 'margin: 0; font-size: 1.2em; font-weight: 600;';

  const newBtn = document.createElement('button');
  newBtn.textContent = 'New Application';
  newBtn.className = 'btn-invite';
  newBtn.style.cssText = 'padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; color: #fff; font-weight: 500;';
  newBtn.addEventListener('click', () => context.router?.navigate(`/${SANCTIONING}/new`));

  header.appendChild(title);
  header.appendChild(newBtn);
  container.appendChild(header);

  // Filter bar
  const filterBar = document.createElement('div');
  filterBar.style.cssText = 'display: flex; gap: 12px; padding: 0 20px 12px; align-items: center;';

  const statusFilter = document.createElement('select');
  statusFilter.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--tmx-border-primary, #ddd);';
  const statuses = ['All', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CONDITIONALLY_APPROVED', 'REJECTED', 'WITHDRAWN', 'ACTIVE', 'POST_EVENT', 'CLOSED', 'ISSUES_FLAGGED'];
  for (const s of statuses) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s === 'All' ? 'All Statuses' : s.replace(/_/g, ' ');
    statusFilter.appendChild(opt);
  }

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search tournament name...';
  searchInput.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--tmx-border-primary, #ddd); flex: 1; max-width: 300px;';

  filterBar.appendChild(statusFilter);
  filterBar.appendChild(searchInput);
  container.appendChild(filterBar);

  // Table container
  const tableDiv = document.createElement('div');
  tableDiv.style.cssText = 'flex: 1; padding: 0 20px 20px; min-height: 0;';
  container.appendChild(tableDiv);

  // Initialize table
  const table = new Tabulator(tableDiv, {
    layout: 'fitColumns',
    placeholder: 'No sanctioning applications found',
    selectable: false,
    height: '100%',
    columns: [
      {
        title: 'Tournament',
        field: 'tournamentName',
        minWidth: 200,
        formatter: 'plaintext',
      },
      {
        title: 'Level',
        field: 'sanctioningLevel',
        width: 100,
        formatter: 'plaintext',
      },
      {
        title: 'Status',
        field: 'status',
        width: 160,
        formatter: statusBadgeFormatter,
      },
      {
        title: 'Start Date',
        field: 'startDate',
        width: 120,
        formatter: 'plaintext',
      },
      {
        title: 'End Date',
        field: 'endDate',
        width: 120,
        formatter: 'plaintext',
      },
      {
        title: 'Applicant',
        field: 'applicant',
        width: 180,
        formatter: 'plaintext',
      },
      {
        title: 'Submitted',
        field: 'submittedAt',
        width: 120,
        formatter: (cell: any) => {
          const val = cell.getValue();
          return val ? new Date(val).toLocaleDateString() : '';
        },
      },
    ],
    data: [],
  });

  // Row click → navigate to detail
  table.on('rowClick', (_e: any, row: any) => {
    const data = row.getData();
    if (data.sanctioningId) {
      context.router?.navigate(`/${SANCTIONING}/${data.sanctioningId}`);
    }
  });

  // Filters
  statusFilter.addEventListener('change', () => applyFilters(table, statusFilter.value, searchInput.value));
  searchInput.addEventListener('input', () => applyFilters(table, statusFilter.value, searchInput.value));

  // Load data
  loadDashboardData(table);
}

function applyFilters(table: any, status: string, search: string) {
  table.clearFilter();
  const filters: any[] = [];
  if (status && status !== 'All') {
    filters.push({ field: 'status', type: '=', value: status });
  }
  if (search) {
    filters.push({ field: 'tournamentName', type: 'like', value: search });
  }
  if (filters.length) table.setFilter(filters);
}

async function loadDashboardData(table: any) {
  try {
    const response: any = await getSanctioningRecords();
    const records = response?.data?.sanctioningRecords ?? [];

    const tableData = records.map((r: any) => ({
      sanctioningId: r.sanctioningId,
      tournamentName: r.proposal?.tournamentName ?? '',
      sanctioningLevel: r.sanctioningLevel ?? '',
      status: r.status,
      startDate: r.proposal?.proposedStartDate ?? '',
      endDate: r.proposal?.proposedEndDate ?? '',
      applicant: r.applicant?.organisationName ?? '',
      submittedAt: r.submittedAt,
    }));

    table.setData(tableData);
  } catch {
    tmxToast({ message: 'Failed to load sanctioning records', intent: 'is-danger' });
  }
}
