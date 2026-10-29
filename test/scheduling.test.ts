import { describe, it, expect } from "vitest";
import {
  computeAvailableSlots,
  findFreeResources,
  isVehicleBusy,
  isWithinOperatingHours,
  overlaps,
  type BusyBlock,
} from "../src/domain/scheduling.js";

const t = (hhmm: string) => Date.parse(`2026-11-02T${hhmm}:00Z`);
const london = { timezone: "Europe/London", opensAtMinute: 8 * 60, closesAtMinute: 18 * 60 };

const block = (start: string, end: string, technicianId: string, serviceBayId: string, vehicleId = "v-x"): BusyBlock => ({
  start: t(start),
  end: t(end),
  technicianId,
  serviceBayId,
  vehicleId,
});

describe("overlaps", () => {
  const nineToTen = { start: t("09:00"), end: t("10:00") };

  it("detects partial overlap", () => {
    expect(overlaps(nineToTen, { start: t("09:30"), end: t("10:30") })).toBe(true);
    expect(overlaps(nineToTen, { start: t("08:30"), end: t("09:01") })).toBe(true);
  });

  it("detects containment in both directions", () => {
    expect(overlaps(nineToTen, { start: t("09:15"), end: t("09:45") })).toBe(true);
    expect(overlaps(nineToTen, { start: t("08:00"), end: t("11:00") })).toBe(true);
  });

  it("treats back-to-back appointments as non-overlapping", () => {
    expect(overlaps(nineToTen, { start: t("10:00"), end: t("11:00") })).toBe(false);
    expect(overlaps(nineToTen, { start: t("08:00"), end: t("09:00") })).toBe(false);
  });
});

describe("isWithinOperatingHours", () => {
  it("accepts a window exactly matching opening hours", () => {
    expect(isWithinOperatingHours({ start: t("08:00"), end: t("18:00") }, london)).toBe(true);
  });

  it("rejects a window starting before opening", () => {
    expect(isWithinOperatingHours({ start: t("07:45"), end: t("08:45") }, london)).toBe(false);
  });

  it("rejects a window running past closing", () => {
    expect(isWithinOperatingHours({ start: t("17:30"), end: t("18:30") }, london)).toBe(false);
  });

  it("evaluates hours in the dealership's local timezone", () => {
    const sydney = { timezone: "Australia/Sydney", opensAtMinute: 7 * 60, closesAtMinute: 17 * 60 };
    // 20:00Z on 1 Nov is 07:00 on 2 Nov in Sydney.
    const start = Date.parse("2026-11-01T20:00:00Z");
    expect(isWithinOperatingHours({ start, end: start + 3_600_000 }, sydney)).toBe(true);
    expect(isWithinOperatingHours({ start: start - 3_600_000, end: start }, sydney)).toBe(false);
  });
});

describe("findFreeResources", () => {
  const candidates = { technicianIds: ["t1", "t2"], serviceBayIds: ["b1", "b2"] };
  const window = { start: t("09:00"), end: t("10:00") };

  it("returns all candidates when nothing is booked", () => {
    expect(findFreeResources(window, candidates, [])).toEqual(candidates);
  });

  it("excludes technicians and bays held by overlapping appointments", () => {
    const free = findFreeResources(window, candidates, [block("09:30", "10:30", "t1", "b2")]);
    expect(free).toEqual({ technicianIds: ["t2"], serviceBayIds: ["b1"] });
  });

  it("ignores appointments that do not overlap", () => {
    const free = findFreeResources(window, candidates, [block("10:00", "11:00", "t1", "b1")]);
    expect(free).toEqual(candidates);
  });

  it("can leave technicians free while all bays are taken", () => {
    const busy = [block("09:00", "10:00", "other-a", "b1"), block("09:00", "10:00", "other-b", "b2")];
    expect(findFreeResources(window, candidates, busy)).toEqual({ technicianIds: ["t1", "t2"], serviceBayIds: [] });
  });
});

describe("isVehicleBusy", () => {
  it("flags only overlapping appointments for the same vehicle", () => {
    const busy = [block("09:00", "10:00", "t1", "b1", "v1")];
    expect(isVehicleBusy({ start: t("09:30"), end: t("10:30") }, "v1", busy)).toBe(true);
    expect(isVehicleBusy({ start: t("09:30"), end: t("10:30") }, "v2", busy)).toBe(false);
    expect(isVehicleBusy({ start: t("10:00"), end: t("11:00") }, "v1", busy)).toBe(false);
  });
});

describe("computeAvailableSlots", () => {
  const base = {
    date: "2026-11-02",
    durationMinutes: 60,
    stepMinutes: 30,
    hours: london,
    candidates: { technicianIds: ["t1"], serviceBayIds: ["b1", "b2"] },
    notBefore: 0,
  };

  it("offers every step whose full duration fits before closing", () => {
    const slots = computeAvailableSlots({ ...base, busy: [] });
    // 08:00 .. 17:00 inclusive in 30-minute steps.
    expect(slots).toHaveLength(19);
    expect(slots[0].start).toBe(t("08:00"));
    expect(slots.at(-1)!.end).toBe(t("18:00"));
  });

  it("removes slots that would overlap the only technician's booking", () => {
    const slots = computeAvailableSlots({ ...base, busy: [block("09:00", "10:00", "t1", "b1")] });
    const starts = slots.map((s) => new Date(s.start).toISOString().slice(11, 16));
    expect(starts).toContain("08:00");
    expect(starts).not.toContain("08:30");
    expect(starts).not.toContain("09:00");
    expect(starts).not.toContain("09:30");
    expect(starts).toContain("10:00");
  });

  it("reports remaining capacity per slot", () => {
    const slots = computeAvailableSlots({
      ...base,
      candidates: { technicianIds: ["t1", "t2"], serviceBayIds: ["b1", "b2"] },
      busy: [block("08:00", "09:00", "t1", "b1")],
    });
    expect(slots[0]).toMatchObject({ start: t("08:00"), availableTechnicians: 1, availableBays: 1 });
    expect(slots[2]).toMatchObject({ start: t("09:00"), availableTechnicians: 2, availableBays: 2 });
  });

  it("excludes slots starting before notBefore", () => {
    const slots = computeAvailableSlots({ ...base, busy: [], notBefore: t("12:10") });
    expect(slots[0].start).toBe(t("12:30"));
  });

  it("returns nothing when no technician is qualified", () => {
    const slots = computeAvailableSlots({ ...base, candidates: { technicianIds: [], serviceBayIds: ["b1"] }, busy: [] });
    expect(slots).toEqual([]);
  });
});
