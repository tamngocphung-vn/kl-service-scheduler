import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, lt, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  appointments,
  customers,
  dealerships,
  serviceBays,
  serviceTypes,
  technicianQualifications,
  technicians,
  vehicles,
  type Appointment,
  type Dealership,
} from "../db/schema.js";
import { AppError, notFound } from "../domain/errors.js";
import {
  computeAvailableSlots,
  findFreeResources,
  isVehicleBusy,
  isWithinOperatingHours,
  type BusyBlock,
  type FreeResources,
  type Interval,
} from "../domain/scheduling.js";
import { isValidLocalDate, localToUtc, minutesToMs } from "../domain/time.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conn = Db | Tx;

export interface BookAppointmentInput {
  dealershipId: string;
  customerId: string;
  vehicleId: string;
  serviceTypeId: string;
  startTime: string; // ISO 8601 with offset
}

export interface AppointmentView {
  id: string;
  status: Appointment["status"];
  dealershipId: string;
  customerId: string;
  vehicleId: string;
  serviceTypeId: string;
  technicianId: string;
  serviceBayId: string;
  startTime: string;
  endTime: string;
  createdAt: string;
  cancelledAt: string | null;
}

export interface SchedulingServiceOptions {
  now?: () => number;
  slotStepMinutes?: number;
}

export function toView(a: Appointment): AppointmentView {
  return {
    id: a.id,
    status: a.status,
    dealershipId: a.dealershipId,
    customerId: a.customerId,
    vehicleId: a.vehicleId,
    serviceTypeId: a.serviceTypeId,
    technicianId: a.technicianId,
    serviceBayId: a.serviceBayId,
    startTime: new Date(a.startsAt).toISOString(),
    endTime: new Date(a.endsAt).toISOString(),
    createdAt: new Date(a.createdAt).toISOString(),
    cancelledAt: a.cancelledAt === null ? null : new Date(a.cancelledAt).toISOString(),
  };
}

function assertValidDate(date: string): void {
  if (!isValidLocalDate(date)) {
    throw new AppError(400, "VALIDATION_ERROR", `'${date}' is not a valid calendar date (YYYY-MM-DD)`);
  }
}

export class SchedulingService {
  private readonly now: () => number;
  private readonly slotStepMinutes: number;

  constructor(
    private readonly db: Db,
    opts: SchedulingServiceOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.slotStepMinutes = opts.slotStepMinutes ?? 15;
  }

  /**
   * Books an appointment if a qualified technician and a service bay are both free for the
   * whole service duration.
   *
   * The availability check and the insert run in one `BEGIN IMMEDIATE` transaction, which takes
   * SQLite's write lock up front. A competing booking (even from another process) waits until
   * this one commits, then sees its row, so two requests can never claim the same resource.
   */
  book(input: BookAppointmentInput, idempotencyKey?: string): { appointment: AppointmentView; created: boolean } {
    return this.db.transaction(
      (tx) => {
        if (idempotencyKey) {
          const existing = tx
            .select()
            .from(appointments)
            .where(eq(appointments.idempotencyKey, idempotencyKey))
            .get();
          if (existing) return { appointment: this.replay(existing, input), created: false };
        }

        const dealership = this.requireDealership(tx, input.dealershipId);
        const serviceType = tx.select().from(serviceTypes).where(eq(serviceTypes.id, input.serviceTypeId)).get();
        if (!serviceType) throw notFound("ServiceType", input.serviceTypeId);
        const customer = tx.select().from(customers).where(eq(customers.id, input.customerId)).get();
        if (!customer) throw notFound("Customer", input.customerId);
        const vehicle = tx.select().from(vehicles).where(eq(vehicles.id, input.vehicleId)).get();
        if (!vehicle) throw notFound("Vehicle", input.vehicleId);
        if (vehicle.customerId !== customer.id) {
          throw new AppError(422, "VEHICLE_NOT_OWNED_BY_CUSTOMER", "Vehicle does not belong to the customer", {
            vehicleId: vehicle.id,
            customerId: customer.id,
          });
        }

        const start = Date.parse(input.startTime);
        const window: Interval = { start, end: start + minutesToMs(serviceType.durationMinutes) };

        if (start < this.now()) {
          throw new AppError(422, "START_TIME_IN_PAST", "Appointment start time must be in the future");
        }
        if (!isWithinOperatingHours(window, dealership)) {
          throw new AppError(
            422,
            "OUTSIDE_OPERATING_HOURS",
            "Appointment must start and finish within the dealership's opening hours",
            {
              timezone: dealership.timezone,
              opensAtMinute: dealership.opensAtMinute,
              closesAtMinute: dealership.closesAtMinute,
            },
          );
        }

        const candidates = this.candidates(tx, dealership.id, serviceType.id);
        if (candidates.technicianIds.length === 0) {
          throw new AppError(
            422,
            "NO_QUALIFIED_TECHNICIAN",
            "No technician at this dealership is qualified for the requested service",
          );
        }

        const busy = this.busyBlocks(tx, window, dealership.id, vehicle.id);
        if (isVehicleBusy(window, vehicle.id, busy)) {
          throw new AppError(409, "VEHICLE_ALREADY_BOOKED", "Vehicle already has an overlapping appointment");
        }

        const free = findFreeResources(window, candidates, busy);
        if (free.technicianIds.length === 0) {
          throw new AppError(409, "NO_TECHNICIAN_AVAILABLE", "No qualified technician is free for the requested time");
        }
        if (free.serviceBayIds.length === 0) {
          throw new AppError(409, "NO_BAY_AVAILABLE", "No service bay is free for the requested time");
        }

        const row: Appointment = {
          id: randomUUID(),
          dealershipId: dealership.id,
          customerId: customer.id,
          vehicleId: vehicle.id,
          serviceTypeId: serviceType.id,
          technicianId: free.technicianIds[0],
          serviceBayId: free.serviceBayIds[0],
          startsAt: window.start,
          endsAt: window.end,
          status: "CONFIRMED",
          idempotencyKey: idempotencyKey ?? null,
          createdAt: this.now(),
          cancelledAt: null,
        };
        tx.insert(appointments).values(row).run();
        return { appointment: toView(row), created: true };
      },
      { behavior: "immediate" },
    );
  }

  getAppointment(id: string): AppointmentView {
    const row = this.db.select().from(appointments).where(eq(appointments.id, id)).get();
    if (!row) throw notFound("Appointment", id);
    return toView(row);
  }

  cancel(id: string): AppointmentView {
    return this.db.transaction(
      (tx) => {
        const row = tx.select().from(appointments).where(eq(appointments.id, id)).get();
        if (!row) throw notFound("Appointment", id);
        if (row.status === "CANCELLED") return toView(row);
        if (row.startsAt <= this.now()) {
          throw new AppError(409, "APPOINTMENT_NOT_CANCELLABLE", "Appointments that have already started cannot be cancelled");
        }
        const cancelledAt = this.now();
        tx.update(appointments).set({ status: "CANCELLED", cancelledAt }).where(eq(appointments.id, id)).run();
        return toView({ ...row, status: "CANCELLED", cancelledAt });
      },
      { behavior: "immediate" },
    );
  }

  /** All appointments (any status) starting on the given local date at the dealership. */
  listForDay(dealershipId: string, date: string): AppointmentView[] {
    assertValidDate(date);
    const dealership = this.requireDealership(this.db, dealershipId);
    const dayStart = localToUtc(date, 0, dealership.timezone);
    const dayEnd = localToUtc(date, 24 * 60, dealership.timezone);
    return this.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.dealershipId, dealershipId),
          gte(appointments.startsAt, dayStart),
          lt(appointments.startsAt, dayEnd),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .all()
      .map(toView);
  }

  availability(dealershipId: string, serviceTypeId: string, date: string) {
    assertValidDate(date);
    const dealership = this.requireDealership(this.db, dealershipId);
    const serviceType = this.db.select().from(serviceTypes).where(eq(serviceTypes.id, serviceTypeId)).get();
    if (!serviceType) throw notFound("ServiceType", serviceTypeId);

    const day: Interval = {
      start: localToUtc(date, dealership.opensAtMinute, dealership.timezone),
      end: localToUtc(date, dealership.closesAtMinute, dealership.timezone),
    };
    const slots = computeAvailableSlots({
      date,
      durationMinutes: serviceType.durationMinutes,
      stepMinutes: this.slotStepMinutes,
      hours: dealership,
      candidates: this.candidates(this.db, dealership.id, serviceType.id),
      busy: this.busyBlocks(this.db, day, dealership.id),
      notBefore: this.now(),
    });

    return {
      dealershipId,
      serviceTypeId,
      date,
      timezone: dealership.timezone,
      durationMinutes: serviceType.durationMinutes,
      slots: slots.map((s) => ({
        startTime: new Date(s.start).toISOString(),
        endTime: new Date(s.end).toISOString(),
        availableTechnicians: s.availableTechnicians,
        availableBays: s.availableBays,
      })),
    };
  }

  private requireDealership(conn: Conn, id: string): Dealership {
    const dealership = conn.select().from(dealerships).where(eq(dealerships.id, id)).get();
    if (!dealership) throw notFound("Dealership", id);
    return dealership;
  }

  /** Active, qualified technicians and active bays at the dealership, in a stable order. */
  private candidates(conn: Conn, dealershipId: string, serviceTypeId: string): FreeResources {
    const technicianIds = conn
      .select({ id: technicians.id })
      .from(technicians)
      .innerJoin(technicianQualifications, eq(technicianQualifications.technicianId, technicians.id))
      .where(
        and(
          eq(technicians.dealershipId, dealershipId),
          eq(technicians.isActive, true),
          eq(technicianQualifications.serviceTypeId, serviceTypeId),
        ),
      )
      .orderBy(asc(technicians.id))
      .all()
      .map((r) => r.id);
    const serviceBayIds = conn
      .select({ id: serviceBays.id })
      .from(serviceBays)
      .where(and(eq(serviceBays.dealershipId, dealershipId), eq(serviceBays.isActive, true)))
      .orderBy(asc(serviceBays.id))
      .all()
      .map((r) => r.id);
    return { technicianIds, serviceBayIds };
  }

  /**
   * Confirmed appointments overlapping `window` at the dealership, plus (optionally) any
   * overlapping appointment for the vehicle at another dealership.
   */
  private busyBlocks(conn: Conn, window: Interval, dealershipId: string, vehicleId?: string): BusyBlock[] {
    const scope = vehicleId
      ? or(eq(appointments.dealershipId, dealershipId), eq(appointments.vehicleId, vehicleId))
      : eq(appointments.dealershipId, dealershipId);
    return conn
      .select({
        start: appointments.startsAt,
        end: appointments.endsAt,
        technicianId: appointments.technicianId,
        serviceBayId: appointments.serviceBayId,
        vehicleId: appointments.vehicleId,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.status, "CONFIRMED"),
          lt(appointments.startsAt, window.end),
          gt(appointments.endsAt, window.start),
          scope,
        ),
      )
      .all();
  }

  /** A retried request with the same Idempotency-Key returns the original booking, unchanged. */
  private replay(existing: Appointment, input: BookAppointmentInput): AppointmentView {
    const same =
      existing.dealershipId === input.dealershipId &&
      existing.customerId === input.customerId &&
      existing.vehicleId === input.vehicleId &&
      existing.serviceTypeId === input.serviceTypeId &&
      existing.startsAt === Date.parse(input.startTime);
    if (!same) {
      throw new AppError(
        422,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used with a different request body",
      );
    }
    return toView(existing);
  }
}
