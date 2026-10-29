// Pure scheduling rules. No I/O here so the core business logic is unit-testable in isolation.
import { localToUtc, minutesToMs, utcToLocal } from "./time.js";

export interface Interval {
  start: number; // UTC epoch ms, inclusive
  end: number; // UTC epoch ms, exclusive
}

/**
 * Upper bound on any appointment's length. Appointments must fit inside one business day
 * (isWithinOperatingHours), so none can reach 24 h. Anything overlapping a window therefore
 * starts after `window.start - MAX_APPOINTMENT_MS`, which lets overlap queries use a bounded
 * index range instead of scanning all history.
 */
export const MAX_APPOINTMENT_MS = 24 * 60 * 60 * 1000;

/** Half-open intervals: an appointment ending at 10:00 does not clash with one starting at 10:00. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface BusyBlock extends Interval {
  technicianId: string;
  serviceBayId: string;
  vehicleId: string;
}

export interface OperatingHours {
  timezone: string;
  opensAtMinute: number;
  closesAtMinute: number;
}

/** True when the whole window falls inside a single local business day's opening hours. */
export function isWithinOperatingHours(window: Interval, hours: OperatingHours): boolean {
  const { date } = utcToLocal(window.start, hours.timezone);
  const open = localToUtc(date, hours.opensAtMinute, hours.timezone);
  const close = localToUtc(date, hours.closesAtMinute, hours.timezone);
  return window.start >= open && window.end <= close;
}

/** True when `start` is no later than `horizonDays` after `now` (the limit itself is allowed). */
export function isWithinBookingHorizon(start: number, now: number, horizonDays: number): boolean {
  return start <= now + horizonDays * 24 * 60 * 60 * 1000;
}

export interface FreeResources {
  technicianIds: string[];
  serviceBayIds: string[];
}

/**
 * Returns the candidate technicians and bays with no overlapping busy block in `window`.
 * Candidate order is preserved so the allocation policy (first-fit) is deterministic.
 */
export function findFreeResources(
  window: Interval,
  candidates: FreeResources,
  busy: readonly BusyBlock[],
): FreeResources {
  const busyTechs = new Set<string>();
  const busyBays = new Set<string>();
  for (const block of busy) {
    if (!overlaps(window, block)) continue;
    busyTechs.add(block.technicianId);
    busyBays.add(block.serviceBayId);
  }
  return {
    technicianIds: candidates.technicianIds.filter((id) => !busyTechs.has(id)),
    serviceBayIds: candidates.serviceBayIds.filter((id) => !busyBays.has(id)),
  };
}

export function isVehicleBusy(window: Interval, vehicleId: string, busy: readonly BusyBlock[]): boolean {
  return busy.some((b) => b.vehicleId === vehicleId && overlaps(window, b));
}

export interface Slot extends Interval {
  availableTechnicians: number;
  availableBays: number;
}

export interface SlotQuery {
  date: string; // local date at the dealership, YYYY-MM-DD
  durationMinutes: number;
  stepMinutes: number;
  hours: OperatingHours;
  candidates: FreeResources;
  busy: readonly BusyBlock[];
  notBefore: number; // slots starting before this instant are excluded (i.e. "now")
  notAfter: number; // slots starting after this instant are excluded (the booking horizon)
}

/** Enumerates every start time on `date` where a qualified technician AND a bay are both free. */
export function computeAvailableSlots(q: SlotQuery): Slot[] {
  const dayOpen = localToUtc(q.date, q.hours.opensAtMinute, q.hours.timezone);
  const dayClose = localToUtc(q.date, q.hours.closesAtMinute, q.hours.timezone);
  const duration = minutesToMs(q.durationMinutes);
  const step = minutesToMs(q.stepMinutes);

  const slots: Slot[] = [];
  for (let start = dayOpen; start + duration <= dayClose; start += step) {
    if (start < q.notBefore) continue;
    if (start > q.notAfter) break;
    const window = { start, end: start + duration };
    const free = findFreeResources(window, q.candidates, q.busy);
    if (free.technicianIds.length > 0 && free.serviceBayIds.length > 0) {
      slots.push({
        ...window,
        availableTechnicians: free.technicianIds.length,
        availableBays: free.serviceBayIds.length,
      });
    }
  }
  return slots;
}
