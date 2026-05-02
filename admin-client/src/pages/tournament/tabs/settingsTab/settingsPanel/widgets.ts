/**
 * Reusable input widgets for the Settings panel topics.
 *
 * - chipMultiSelect: closed-list multi-select with three rendering modes,
 *   chosen by which universe is supplied:
 *
 *     1. `pinnedUniverse` (provisioner-restricted) — chips render the
 *        provisioner's allowed list. Selected chips that fall outside
 *        the cap render as orphan chips so the user can see and clear
 *        them.
 *
 *     2. `fullUniverse` (factory enum, no provisioner restriction) —
 *        chips render the full factory enum. Same toggle behavior, no
 *        orphan handling needed: any value not in the enum is invalid.
 *
 *     3. neither — free-form text input for grammars whose universe
 *        isn't a fixed enum (matchUpFormatCode strings).
 *
 * - rowEditor: simple add/edit/delete table for a list of records.
 */

export interface ChipMultiSelectOpts {
  label: string;
  values: string[];
  /** Provisioner-restricted universe; takes precedence over `fullUniverse`. */
  pinnedUniverse?: string[];
  /** Closed factory enum used when caps don't restrict the universe. */
  fullUniverse?: readonly string[];
  /**
   * Optional display-label override for individual values. Used when the
   * stored value is an opaque id (e.g. a topology UUID) and the chip
   * should render a human-readable name. Falls back to the raw value
   * when no override is present.
   */
  labels?: Record<string, string>;
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
  const pinned = opts.pinnedUniverse && opts.pinnedUniverse.length ? opts.pinnedUniverse : null;
  const full = opts.fullUniverse && opts.fullUniverse.length ? opts.fullUniverse : null;

  function emit(): void {
    opts.onChange([...selected]);
  }

  const labelFor = (value: string): string => opts.labels?.[value] ?? value;

  function rebuild(): void {
    chipsHost.innerHTML = '';

    if (pinned) {
      for (const value of pinned) {
        chipsHost.appendChild(makeChip(labelFor(value), selected.has(value), () => toggle(value)));
      }
      // Surface any selected values that aren't in the universe (legacy /
      // out-of-cap data). Render them as chips with an out-of-cap visual
      // marker so the user can see and remove them.
      const orphans = [...selected].filter((v) => !pinned.includes(v));
      for (const value of orphans) {
        chipsHost.appendChild(makeChip(labelFor(value), true, () => toggle(value), { orphan: true }));
      }
      const hint = document.createElement('div');
      hint.className = 'sp-chips-hint';
      hint.textContent = 'Click to toggle. Provisioner-allowed list above.';
      chipsHost.appendChild(hint);
    } else if (full) {
      for (const value of full) {
        chipsHost.appendChild(makeChip(labelFor(value), selected.has(value), () => toggle(value)));
      }
      const orphans = [...selected].filter((v) => !full.includes(v));
      for (const value of orphans) {
        chipsHost.appendChild(makeChip(labelFor(value), true, () => toggle(value), { orphan: true }));
      }
      const hint = document.createElement('div');
      hint.className = 'sp-chips-hint';
      hint.textContent = 'Click to toggle. Empty selection = all values allowed.';
      chipsHost.appendChild(hint);
    } else {
      for (const value of selected) {
        chipsHost.appendChild(makeChip(labelFor(value), true, () => toggle(value)));
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
  input.placeholder = placeholder ?? 'Type to add, then Enter or +';
  input.className = 'sp-chip-add-input';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sp-chip-add-btn';
  btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  btn.title = 'Add';

  function syncBtnState(): void {
    const hasValue = input.value.trim().length > 0;
    btn.classList.toggle('is-ready', hasValue);
    // Keep the button enabled even when empty so the click handler can
    // run (focus the input). Disabled buttons swallow clicks entirely.
  }

  function commit(): boolean {
    const v = input.value.trim();
    if (!v) {
      input.focus();
      return false;
    }
    onAdd(v);
    return true;
  }

  input.addEventListener('input', syncBtnState);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });
  btn.addEventListener('click', () => {
    if (!commit()) return;
    // commit() already wrote the value; rebuild() destroys this input
    // when chips re-render, so nothing else to do here.
  });

  wrap.appendChild(input);
  wrap.appendChild(btn);
  syncBtnState();
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
