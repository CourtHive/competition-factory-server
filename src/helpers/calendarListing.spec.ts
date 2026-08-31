import { describe, expect, it } from 'vitest';

import { CALENDAR_LISTED, isCalendarListed } from './calendarListing';

const withExtension = (value: any) => ({ extensions: [{ name: CALENDAR_LISTED, value }] });

describe('isCalendarListed', () => {
  it('lists by default, so every existing record keeps its behaviour', () => {
    // The dangerous direction. A default of "unlisted" would silently empty every calendar in the
    // system on deploy, and nothing would error.
    expect(isCalendarListed({})).toBe(true);
    expect(isCalendarListed({ extensions: [] })).toBe(true);
    expect(isCalendarListed(undefined)).toBe(true);
    expect(isCalendarListed({ extensions: [{ name: 'somethingElse', value: false }] })).toBe(true);
  });

  it('opts out only on a strict false', () => {
    expect(isCalendarListed(withExtension(false))).toBe(false);
  });

  it('lists on a truthy or malformed value rather than guessing', () => {
    // Withholding a tournament from its own calendar on a misread is the worse failure, so anything
    // that is not exactly `false` lists.
    expect(isCalendarListed(withExtension(true))).toBe(true);
    expect(isCalendarListed(withExtension('false'))).toBe(true);
    expect(isCalendarListed(withExtension(0))).toBe(true);
    expect(isCalendarListed(withExtension(null))).toBe(true);
  });
});
