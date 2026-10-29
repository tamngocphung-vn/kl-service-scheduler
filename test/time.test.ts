import { describe, it, expect } from "vitest";
import { isValidLocalDate, localToUtc, utcToLocal } from "../src/domain/time.js";

describe("localToUtc", () => {
  it("converts London winter time (GMT, UTC+0)", () => {
    expect(new Date(localToUtc("2026-11-02", 9 * 60, "Europe/London")).toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });

  it("converts London summer time (BST, UTC+1)", () => {
    expect(new Date(localToUtc("2026-07-01", 9 * 60, "Europe/London")).toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });

  it("handles the day after a DST change", () => {
    // UK clocks go back on 25 Oct 2026.
    expect(new Date(localToUtc("2026-10-24", 8 * 60, "Europe/London")).toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(new Date(localToUtc("2026-10-26", 8 * 60, "Europe/London")).toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("converts timezones ahead of UTC across the date line", () => {
    expect(new Date(localToUtc("2026-11-02", 7 * 60, "Australia/Sydney")).toISOString()).toBe("2026-11-01T20:00:00.000Z");
  });
});

describe("utcToLocal", () => {
  it("returns the local date and minute of day", () => {
    expect(utcToLocal(Date.parse("2026-11-01T20:00:00Z"), "Australia/Sydney")).toEqual({
      date: "2026-11-02",
      minuteOfDay: 7 * 60,
    });
  });

  it("round-trips with localToUtc", () => {
    const utc = localToUtc("2026-03-29", 10 * 60 + 30, "Europe/London");
    expect(utcToLocal(utc, "Europe/London")).toEqual({ date: "2026-03-29", minuteOfDay: 10 * 60 + 30 });
  });
});

describe("isValidLocalDate", () => {
  it.each(["2026-11-02", "2028-02-29"])("accepts %s", (d) => expect(isValidLocalDate(d)).toBe(true));
  it.each(["2026-02-30", "2026-13-01", "2026-1-1", "tomorrow"])("rejects %s", (d) =>
    expect(isValidLocalDate(d)).toBe(false),
  );
});
