/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chipMultiSelect } from '../widgets';

function mount(opts: Parameters<typeof chipMultiSelect>[0]): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.appendChild(chipMultiSelect(opts));
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('chipMultiSelect — restricted universe (caps defines allowed list)', () => {
  it('renders one chip per universe value plus a hint', () => {
    const container = mount({
      label: 'Test',
      values: [],
      pinnedUniverse: ['A', 'B', 'C'],
      onChange: () => undefined,
    });
    const chips = container.querySelectorAll('.sp-chip');
    expect(chips.length).toBe(3);
    expect(container.querySelector('.sp-chips-hint')).toBeTruthy();
  });

  it('toggling an unselected chip emits the selected value', () => {
    const onChange = vi.fn();
    const container = mount({
      label: 'Test',
      values: [],
      pinnedUniverse: ['A', 'B'],
      onChange,
    });
    const chipA = container.querySelector<HTMLButtonElement>('.sp-chip')!;
    chipA.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['A']);
  });

  it('toggling an already-selected chip removes it', () => {
    const onChange = vi.fn();
    const container = mount({
      label: 'Test',
      values: ['A'],
      pinnedUniverse: ['A', 'B'],
      onChange,
    });
    const chipA = container.querySelector<HTMLButtonElement>('.sp-chip.is-selected')!;
    chipA.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([]);
  });

  it('marks orphan values selected outside the universe', () => {
    const container = mount({
      label: 'Test',
      values: ['LEGACY'],
      pinnedUniverse: ['A', 'B'],
      onChange: () => undefined,
    });
    const orphan = container.querySelector('.sp-chip.is-orphan');
    expect(orphan?.textContent).toContain('LEGACY');
  });
});

describe('chipMultiSelect — fullUniverse (factory enum, no caps)', () => {
  it('renders one chip per fullUniverse value plus a hint', () => {
    const container = mount({
      label: 'Draw Types',
      values: [],
      fullUniverse: ['SINGLE_ELIMINATION', 'ROUND_ROBIN', 'COMPASS'],
      onChange: () => undefined,
    });
    const chips = container.querySelectorAll('.sp-chip');
    expect(chips.length).toBe(3);
    expect(container.querySelector('.sp-chips-hint')).toBeTruthy();
    // No free-form add input when a closed universe is supplied.
    expect(container.querySelector('.sp-chip-add-input')).toBeFalsy();
  });

  it('toggling an unselected chip emits the selected value', () => {
    const onChange = vi.fn();
    const container = mount({
      label: 'Draw Types',
      values: [],
      fullUniverse: ['SINGLE_ELIMINATION', 'ROUND_ROBIN'],
      onChange,
    });
    const chip = container.querySelector<HTMLButtonElement>('.sp-chip')!;
    chip.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['SINGLE_ELIMINATION']);
  });

  it('orphan values outside the fullUniverse render with the orphan modifier', () => {
    const container = mount({
      label: 'Draw Types',
      values: ['LEGACY_TYPE'],
      fullUniverse: ['SINGLE_ELIMINATION', 'ROUND_ROBIN'],
      onChange: () => undefined,
    });
    const orphan = container.querySelector('.sp-chip.is-orphan');
    expect(orphan?.textContent).toContain('LEGACY_TYPE');
  });

  it('pinnedUniverse takes precedence over fullUniverse', () => {
    const container = mount({
      label: 'Draw Types',
      values: [],
      pinnedUniverse: ['ROUND_ROBIN'],
      fullUniverse: ['SINGLE_ELIMINATION', 'ROUND_ROBIN', 'COMPASS'],
      onChange: () => undefined,
    });
    const chips = container.querySelectorAll('.sp-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('ROUND_ROBIN');
  });
});

describe('chipMultiSelect — unrestricted universe (no caps, no fullUniverse)', () => {
  it('renders only selected chips and an add input', () => {
    const container = mount({
      label: 'Test',
      values: ['X'],
      onChange: () => undefined,
    });
    expect(container.querySelectorAll('.sp-chip').length).toBe(1);
    expect(container.querySelector('.sp-chip-add-input')).toBeTruthy();
    expect(container.querySelector('.sp-chip-add-btn')).toBeTruthy();
  });

  it('typing in the input enables the ready state on the add button', () => {
    const container = mount({
      label: 'Test',
      values: [],
      onChange: () => undefined,
    });
    const input = container.querySelector<HTMLInputElement>('.sp-chip-add-input')!;
    const btn = container.querySelector<HTMLButtonElement>('.sp-chip-add-btn')!;

    expect(btn.classList.contains('is-ready')).toBe(false);
    input.value = 'NEW';
    input.dispatchEvent(new Event('input'));
    expect(btn.classList.contains('is-ready')).toBe(true);
  });

  it('clicking + with text in the input emits the new value', () => {
    const onChange = vi.fn();
    const container = mount({
      label: 'Test',
      values: [],
      onChange,
    });
    const input = container.querySelector<HTMLInputElement>('.sp-chip-add-input')!;
    const btn = container.querySelector<HTMLButtonElement>('.sp-chip-add-btn')!;

    input.value = 'ADDED';
    input.dispatchEvent(new Event('input'));
    btn.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['ADDED']);
  });

  it('clicking + with empty input focuses the input rather than no-op', () => {
    const container = mount({
      label: 'Test',
      values: [],
      onChange: () => undefined,
    });
    const input = container.querySelector<HTMLInputElement>('.sp-chip-add-input')!;
    const btn = container.querySelector<HTMLButtonElement>('.sp-chip-add-btn')!;

    btn.click();
    expect(document.activeElement).toBe(input);
  });

  it('Enter on the input commits the value', () => {
    const onChange = vi.fn();
    const container = mount({
      label: 'Test',
      values: [],
      onChange,
    });
    const input = container.querySelector<HTMLInputElement>('.sp-chip-add-input')!;
    input.value = 'VIA_ENTER';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['VIA_ENTER']);
  });

  it('adding a duplicate value is a no-op', () => {
    const onChange = vi.fn();
    const container = mount({
      label: 'Test',
      values: ['DUP'],
      onChange,
    });
    const input = container.querySelector<HTMLInputElement>('.sp-chip-add-input')!;
    const btn = container.querySelector<HTMLButtonElement>('.sp-chip-add-btn')!;

    input.value = 'DUP';
    input.dispatchEvent(new Event('input'));
    btn.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('after add, the input is back in the DOM (rebuild kept the field)', () => {
    const container = mount({
      label: 'Test',
      values: [],
      onChange: () => undefined,
    });
    const inputBefore = container.querySelector<HTMLInputElement>('.sp-chip-add-input')!;
    inputBefore.value = 'A';
    inputBefore.dispatchEvent(new Event('input'));
    const btn = container.querySelector<HTMLButtonElement>('.sp-chip-add-btn')!;
    btn.click();
    // The previous input element is no longer in the DOM; a fresh one
    // is rendered as part of the rebuild.
    const inputAfter = container.querySelector<HTMLInputElement>('.sp-chip-add-input');
    expect(inputAfter).toBeTruthy();
    expect(inputAfter).not.toBe(inputBefore);
  });
});
