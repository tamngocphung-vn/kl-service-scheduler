import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Operating hours are minutes after local midnight in the dealership's IANA timezone.
export const dealerships = sqliteTable("dealerships", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  opensAtMinute: integer("opens_at_minute").notNull(),
  closesAtMinute: integer("closes_at_minute").notNull(),
});

export const serviceTypes = sqliteTable("service_types", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
});

export const serviceBays = sqliteTable(
  "service_bays",
  {
    id: text("id").primaryKey(),
    dealershipId: text("dealership_id")
      .notNull()
      .references(() => dealerships.id),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("service_bays_dealership_idx").on(t.dealershipId)],
);

export const technicians = sqliteTable(
  "technicians",
  {
    id: text("id").primaryKey(),
    dealershipId: text("dealership_id")
      .notNull()
      .references(() => dealerships.id),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("technicians_dealership_idx").on(t.dealershipId)],
);

// Which service types a technician is qualified to perform.
export const technicianQualifications = sqliteTable(
  "technician_qualifications",
  {
    technicianId: text("technician_id")
      .notNull()
      .references(() => technicians.id),
    serviceTypeId: text("service_type_id")
      .notNull()
      .references(() => serviceTypes.id),
  },
  (t) => [
    primaryKey({ columns: [t.technicianId, t.serviceTypeId] }),
    index("tech_qual_service_type_idx").on(t.serviceTypeId),
  ],
);

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
});

export const vehicles = sqliteTable(
  "vehicles",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    vin: text("vin").notNull().unique(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: integer("year").notNull(),
  },
  (t) => [index("vehicles_customer_idx").on(t.customerId)],
);

export const APPOINTMENT_STATUSES = ["CONFIRMED", "CANCELLED"] as const;

// starts_at / ends_at are UTC epoch milliseconds so overlap checks are plain integer comparisons.
export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    dealershipId: text("dealership_id")
      .notNull()
      .references(() => dealerships.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    serviceTypeId: text("service_type_id")
      .notNull()
      .references(() => serviceTypes.id),
    technicianId: text("technician_id")
      .notNull()
      .references(() => technicians.id),
    serviceBayId: text("service_bay_id")
      .notNull()
      .references(() => serviceBays.id),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: integer("created_at").notNull(),
    cancelledAt: integer("cancelled_at"),
  },
  (t) => [
    index("appointments_dealership_time_idx").on(t.dealershipId, t.startsAt),
    index("appointments_technician_time_idx").on(t.technicianId, t.startsAt),
    index("appointments_bay_time_idx").on(t.serviceBayId, t.startsAt),
    index("appointments_vehicle_time_idx").on(t.vehicleId, t.startsAt),
    uniqueIndex("appointments_idempotency_key_idx")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

export type Dealership = typeof dealerships.$inferSelect;
export type ServiceType = typeof serviceTypes.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
