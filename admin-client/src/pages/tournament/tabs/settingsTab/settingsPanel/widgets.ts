/**
 * Reusable input widgets for the Settings panel topics.
 *
 * - chipMultiSelect: cap-aware multi-select. When `pinnedUniverse` is
 *   provided (provisioner-restricted), every value renders as a chip
 *   that toggles on click. When `pinnedUniverse` is empty/undefined
 *   (no cap restriction), only the user's selections render as chips
 *   and a text input lets them add arbitrary values.
 *
 * - rowEditor: simple add/edit/delete table for a list of records.
 */

export interface ChipMultiSelectOpts {
  label: string;
  values: string[];
  pinnedUniverse?: string[];
  placeholder?: string;
  onChange: (next: string[]) => void;
}

export function chipMultiSelect(opts: ChipMultiSelectOpts): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sp-field sp-field-wide';

  const labelRow = document.createElement('div');
  labelRow.className = 'sp-field-label-row';
  const label = document.createElement('span');
  label.className = 'sp-field-label';
  label.textContent = opts.label;
  labelRow.appendChild(label);
  wrap.appendChild(labelRow);

  const chipsHost = document.createElement('div');
  chipsHost.className = 'sp-chips';
  wrap.appendChild(chipsHost);

  const selected = new Set(opts.values);
  const restricted = !!(opts.pinnedUniverse && opts.pinnedUniverse.length);

  function emit(): void {
    opts.onChange([...selected]);
  }

  function rebuild(): void {
    chipsHost.innerHTML = '';

    if (restricted) {
      const universe = opts.pinnedUniverse!;
      for (const value of universe) {
        chipsHost.appendChild(makeChip(value, selected.has(value), () => toggle(value)));
      }
      // Surface any selected values that aren't in the universe (legacy /
      // out-of-cap data). Render them as chips with an out-of-cap visual
      // marker so the user can see and remove them.
      const orphans = [...selected].filter((v) => !universe.includes(v));
      for (const value of orphans) {
        chipsHost.appendChild(makeChip(value, true, () => toggle(value), { orphan: true }));
      }
      const hint = document.createElement('div');
      hint.className = 'sp-chips-hint';
      hint.textContent = 'Click to toggle. Provisioner-allowed list above.';
      chipsHost.appendChild(hint);
    } else {
      for (const value of selected) {
        chipsHost.appendChild(makeChip(value, true, () => toggle(value)));
      }
      chipsHost.appendChild(buildAddInput(opts.placeholder, (v) => add(v)));
    }
  }

  function toggle(value: string): void {
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    emit();
    rebuild();
  }

  function add(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (selected.has(trimmed)) return;
    selected.add(trimmed);
    emit();
    rebuild();
  }

  rebuild();
  return wrap;
}

function makeChip(
  label: string,
  selected: boolean,
  onClick: () => void,
  opts?: { orphan?: boolean },
): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'sp-chip' + (selected ? ' is-selected' : '') + (opts?.orphan ? ' is-orphan' : '');
  chip.title = opts?.orphan ? 'Outside provisioner-allowed list — click to remove' : '';
  chip.innerHTML = `<span class="sp-chip-label"></span>${selected ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-plus"></i>'}`;
  chip.querySelector<HTMLElement>('.sp-chip-label')!.textContent = label;
  chip.addEventListener('click', onClick);
  return chip;
}

function buildAddInput(placeholder: string | undefined, onAdd: (value: string) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sp-chip-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder ?? 'Add…';
  input.className = 'sp-chip-add-input';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value;
      if (v.trim()) {
        onAdd(v);
        input.value = '';
      }
    }
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sp-chip-add-btn';
  btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  btn.title = 'Add';
  btn.addEventListener('click', () => {
    const v = input.value;
    if (v.trim()) {
      onAdd(v);
      input.value = '';
    }
  });
  wrap.appendChild(input);
  wrap.appendChild(btn);
  return wrap;
}

// ── Row editor (used by Categories) ────────────────────────────────────────

export interface RowEditorColumn<T> {
  key: keyof T & string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export interface RowEditorOpts<T extends Record<string, any>> {
  rows: T[];
  columns: RowEditorColumn<T>[];
  onChange: (next: T[]) => void;
  emptyRow: () => T;
  isEmpty?: (row: T) => boolean;
  /** Hint values shown below the editor (e.g., caps universe). */
  hint?: string;
}

export function rowEditor<T extends Record<string, any>>(opts: RowEditorOpts<T>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sp-row-editor';

  const rows = [...opts.rows];

  const tableHost = document.createElement('div');
  tableHost.className = 'sp-row-table';
  wrap.appendChild(tableHost);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'sp-row-add-btn';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add row';
  addBtn.addEventListener('click', () => {
    rows.push(opts.emptyRow());
    emit();
    rebuild();
  });
  wrap.appendChild(addBtn);

  if (opts.hint) {
    const hint = document.createElement('div');
    hint.className = 'sp-row-hint';
    hint.textContent = opts.hint;
    wrap.appendChild(hint);
  }

  function emit(): void {
    const cleaned = opts.isEmpty ? rows.filter((r) => !opts.isEmpty!(r)) : rows;
    opts.onChange(cleaned);
  }

  function rebuild(): void {
    tableHost.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'sp-row-header';
    for (const col of opts.columns) {
      const cell = document.createElement('div');
      cell.className = 'sp-row-cell-header';
      cell.textContent = col.label + (col.required ? ' *' : '');
      headerRow.appendChild(cell);
    }
    headerRow.appendChild(document.createElement('div')); // delete column header
    tableHost.appendChild(headerRow);

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sp-row-empty';
      empty.textContent = 'No rows. Click Add row to start.';
      tableHost.appendChild(empty);
      return;
    }

    rows.forEach((row, idx) => {
      const tr = document.createElement('div');
      tr.className = 'sp-row';
      for (const col of opts.columns) {
        const cell = document.createElement('div');
        cell.className = 'sp-row-cell';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sp-field-input';
        input.placeholder = col.placeholder ?? '';
        input.value = String(row[col.key] ?? '');
        input.addEventListener('input', () => {
          (rows[idx] as any)[col.key] = input.value;
          emit();
        });
        cell.appendChild(input);
        tr.appendChild(cell);
      }
      const delCell = document.createElement('div');
      delCell.className = 'sp-row-cell-delete';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sp-row-del-btn';
      delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      delBtn.title = 'Remove row';
      delBtn.addEventListener('click', () => {
        rows.splice(idx, 1);
        emit();
        rebuild();
      });
      delCell.appendChild(delBtn);
      tr.appendChild(delCell);
      tableHost.appendChild(tr);
    });
  }

  rebuild();
  return wrap;
}
