import type { Db } from "./client.js";
import {
  customers,
  dealerships,
  serviceBays,
  serviceTypes,
  technicianQualifications,
  technicians,
  vehicles,
} from "./schema.js";

// Human-readable IDs keep the demo cURL script easy to follow. Real records use UUIDs.
export const SEED = {
  dealerships: [
    { id: "dlr-london", name: "Keyloop Motors London", timezone: "Europe/London", opensAtMinute: 8 * 60, closesAtMinute: 18 * 60 },
    { id: "dlr-sydney", name: "Keyloop Motors Sydney", timezone: "Australia/Sydney", opensAtMinute: 7 * 60, closesAtMinute: 17 * 60 },
  ],
  serviceTypes: [
    { id: "svc-oil", code: "OIL_CHANGE", name: "Oil & filter change", durationMinutes: 60 },
    { id: "svc-brakes", code: "BRAKE_SERVICE", name: "Brake pads & discs", durationMinutes: 120 },
    { id: "svc-mot", code: "MOT", name: "MOT inspection", durationMinutes: 45 },
    { id: "svc-ev", code: "EV_BATTERY_CHECK", name: "EV battery health check", durationMinutes: 90 },
  ],
  serviceBays: [
    { id: "bay-ldn-1", dealershipId: "dlr-london", name: "Bay 1" },
    { id: "bay-ldn-2", dealershipId: "dlr-london", name: "Bay 2" },
    { id: "bay-syd-1", dealershipId: "dlr-sydney", name: "Bay 1" },
  ],
  technicians: [
    { id: "tech-ldn-alice", dealershipId: "dlr-london", name: "Alice Smith" },
    { id: "tech-ldn-bob", dealershipId: "dlr-london", name: "Bob Jones" },
    { id: "tech-ldn-chen", dealershipId: "dlr-london", name: "Chen Wei" },
    { id: "tech-syd-dana", dealershipId: "dlr-sydney", name: "Dana Lee" },
  ],
  qualifications: [
    { technicianId: "tech-ldn-alice", serviceTypeId: "svc-oil" },
    { technicianId: "tech-ldn-alice", serviceTypeId: "svc-brakes" },
    { technicianId: "tech-ldn-alice", serviceTypeId: "svc-mot" },
    { technicianId: "tech-ldn-bob", serviceTypeId: "svc-oil" },
    { technicianId: "tech-ldn-bob", serviceTypeId: "svc-mot" },
    { technicianId: "tech-ldn-chen", serviceTypeId: "svc-ev" },
    { technicianId: "tech-ldn-chen", serviceTypeId: "svc-brakes" },
    { technicianId: "tech-syd-dana", serviceTypeId: "svc-oil" },
  ],
  customers: [
    { id: "cust-jane", name: "Jane Doe", email: "jane.doe@example.com", phone: "+44 7700 900001" },
    { id: "cust-raj", name: "Raj Patel", email: "raj.patel@example.com", phone: "+44 7700 900002" },
    { id: "cust-maria", name: "Maria Garcia", email: "maria.garcia@example.com", phone: null },
  ],
  vehicles: [
    { id: "veh-jane-golf", customerId: "cust-jane", vin: "WVWZZZ1KZ6W000001", make: "Volkswagen", model: "Golf", year: 2019 },
    { id: "veh-jane-leaf", customerId: "cust-jane", vin: "SJNFAAZE1U0000002", make: "Nissan", model: "Leaf", year: 2022 },
    { id: "veh-raj-civic", customerId: "cust-raj", vin: "SHHFK7H50JU000003", make: "Honda", model: "Civic", year: 2018 },
    { id: "veh-maria-model3", customerId: "cust-maria", vin: "5YJ3E1EA7KF000004", make: "Tesla", model: "Model 3", year: 2021 },
  ],
};

/** Inserts reference/demo data. Safe to run repeatedly. */
export function seed(db: Db): void {
  db.transaction((tx) => {
    tx.insert(dealerships).values(SEED.dealerships).onConflictDoNothing().run();
    tx.insert(serviceTypes).values(SEED.serviceTypes).onConflictDoNothing().run();
    tx.insert(serviceBays).values(SEED.serviceBays).onConflictDoNothing().run();
    tx.insert(technicians).values(SEED.technicians).onConflictDoNothing().run();
    tx.insert(technicianQualifications).values(SEED.qualifications).onConflictDoNothing().run();
    tx.insert(customers).values(SEED.customers).onConflictDoNothing().run();
    tx.insert(vehicles).values(SEED.vehicles).onConflictDoNothing().run();
  });
}
