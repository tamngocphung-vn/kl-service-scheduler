import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appointments } from "../src/db/schema.js";
import { JANE_LEAF, MARIA, MONDAY, RAJ, booking, createTestApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.close();
});

const book = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: "POST", url: "/v1/appointments", payload: body, headers });

describe("POST /v1/appointments: successful booking", () => {
  it("creates a confirmed appointment linking customer, vehicle, technician and bay", async () => {
    const res = await book(booking());

    expect(res.statusCode).toBe(201);
    const appt = res.json();
    expect(appt).toMatchObject({
      status: "CONFIRMED",
      dealershipId: "dlr-london",
      customerId: "cust-jane",
      vehicleId: "veh-jane-golf",
      serviceTypeId: "svc-oil",
      technicianId: "tech-ldn-alice",
      serviceBayId: "bay-ldn-1",
      startTime: `${MONDAY}T09:00:00.000Z`,
      endTime: `${MONDAY}T10:00:00.000Z`,
      cancelledAt: null,
    });
  });

  it("persists the appointment so it can be read back", async () => {
    const created = (await book(booking())).json();

    const res = await ctx.app.inject({ method: "GET", url: `/v1/appointments/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(created);
    expect(ctx.db.select().from(appointments).all()).toHaveLength(1);
  });

  it("only assigns a technician qualified for the service type", async () => {
    // Only Chen is qualified for EV battery checks at London.
    const res = await book(booking({ ...JANE_LEAF, serviceTypeId: "svc-ev" }));
    expect(res.statusCode).toBe(201);
    expect(res.json().technicianId).toBe("tech-ldn-chen");
  });

  it("uses the service type's duration for the end time", async () => {
    const res = await book(booking({ serviceTypeId: "svc-brakes" }));
    expect(res.json().endTime).toBe(`${MONDAY}T11:00:00.000Z`);
  });

  it("accepts start times with a UTC offset", async () => {
    const res = await book(booking({ startTime: `${MONDAY}T10:00:00+01:00` }));
    expect(res.statusCode).toBe(201);
    expect(res.json().startTime).toBe(`${MONDAY}T09:00:00.000Z`);
  });

  it("applies opening hours in the dealership's own timezone", async () => {
    // Sydney opens 07:00 local = 20:00Z the previous day (AEDT, UTC+11).
    const sydney = { dealershipId: "dlr-sydney", ...RAJ };
    expect((await book(booking({ ...sydney, startTime: "2026-11-01T20:00:00Z" }))).statusCode).toBe(201);
    const early = await book(booking({ ...sydney, ...MARIA, startTime: "2026-11-01T19:00:00Z" }));
    expect(early.statusCode).toBe(422);
    expect(early.json().error.code).toBe("OUTSIDE_OPERATING_HOURS");
  });
});

describe("POST /v1/appointments: resource availability", () => {
  it("rejects when every qualified technician is busy for the window", async () => {
    expect((await book(booking({ ...JANE_LEAF, serviceTypeId: "svc-ev" }))).statusCode).toBe(201);

    const res = await book(booking({ ...MARIA, serviceTypeId: "svc-ev", startTime: `${MONDAY}T09:30:00Z` }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_TECHNICIAN_AVAILABLE");
  });

  it("rejects when every bay is occupied even if a technician is free", async () => {
    // London has two bays. Alice and Bob take both, leaving Chen free but no bay.
    expect((await book(booking())).json().serviceBayId).toBe("bay-ldn-1");
    expect((await book(booking({ ...RAJ }))).json().serviceBayId).toBe("bay-ldn-2");

    const res = await book(booking({ ...MARIA, serviceTypeId: "svc-ev" }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_BAY_AVAILABLE");
  });

  it("allocates a different technician when the first is busy", async () => {
    await book(booking());
    const res = await book(booking({ ...RAJ }));
    expect(res.json().technicianId).toBe("tech-ldn-bob");
  });

  it.each([
    ["starts during an existing appointment", "10:15"],
    ["would run into an existing appointment", "08:00"],
  ])("checks the entire service duration: rejects a request that %s", async (_label, hhmm) => {
    // Chen (the only EV tech) is booked 09:00-10:30; an EV check takes 90 minutes.
    await book(booking({ ...JANE_LEAF, serviceTypeId: "svc-ev" }));
    const res = await book(booking({ ...MARIA, serviceTypeId: "svc-ev", startTime: `${MONDAY}T${hhmm}:00Z` }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_TECHNICIAN_AVAILABLE");
  });

  it("allows back-to-back bookings on the same resources", async () => {
    await book(booking({ ...JANE_LEAF, serviceTypeId: "svc-ev" })); // 09:00-10:30
    const res = await book(booking({ ...MARIA, serviceTypeId: "svc-ev", startTime: `${MONDAY}T10:30:00Z` }));
    expect(res.statusCode).toBe(201);
    expect(res.json().technicianId).toBe("tech-ldn-chen");
  });

  it("prevents the same vehicle being booked into two overlapping appointments", async () => {
    await book(booking());
    const res = await book(booking({ serviceTypeId: "svc-mot", startTime: `${MONDAY}T09:30:00Z` }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("VEHICLE_ALREADY_BOOKED");
  });

  it("frees the technician and bay when an appointment is cancelled", async () => {
    const first = (await book(booking({ ...JANE_LEAF, serviceTypeId: "svc-ev" }))).json();
    expect((await book(booking({ ...MARIA, serviceTypeId: "svc-ev" }))).statusCode).toBe(409);

    const cancel = await ctx.app.inject({ method: "POST", url: `/v1/appointments/${first.id}/cancel` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("CANCELLED");

    expect((await book(booking({ ...MARIA, serviceTypeId: "svc-ev" }))).statusCode).toBe(201);
  });

  it("books exactly one of many simultaneous requests for the last slot", async () => {
    const contenders = [JANE_LEAF, MARIA, RAJ, { customerId: "cust-jane", vehicleId: "veh-jane-golf" }];
    const results = await Promise.all(contenders.map((c) => book(booking({ ...c, serviceTypeId: "svc-ev" }))));

    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(contenders.length - 1);
  });
});

describe("POST /v1/appointments: validation", () => {
  it.each([
    ["dealership", { dealershipId: "nope" }],
    ["service type", { serviceTypeId: "nope" }],
    ["customer", { customerId: "nope" }],
    ["vehicle", { vehicleId: "nope" }],
  ])("returns 404 for an unknown %s", async (_label, override) => {
    const res = await book(booking(override));
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a vehicle that does not belong to the customer", async () => {
    const res = await book(booking({ customerId: "cust-raj" }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VEHICLE_NOT_OWNED_BY_CUSTOMER");
  });

  it("rejects start times in the past", async () => {
    const res = await book(booking({ startTime: "2026-10-30T09:00:00Z" }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("START_TIME_IN_PAST");
  });

  it.each([
    ["before opening", "07:30"],
    ["running past closing", "17:30"],
  ])("rejects appointments %s", async (_label, hhmm) => {
    const res = await book(booking({ startTime: `${MONDAY}T${hhmm}:00Z` }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("OUTSIDE_OPERATING_HOURS");
  });

  it("rejects a service no technician at the dealership is qualified for", async () => {
    const res = await book(booking({ dealershipId: "dlr-sydney", serviceTypeId: "svc-ev", startTime: "2026-11-02T00:00:00Z" }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NO_QUALIFIED_TECHNICIAN");
  });

  it.each([
    ["missing field", { startTime: undefined }],
    ["malformed timestamp", { startTime: "next tuesday" }],
    ["unknown field", { technicianId: "tech-ldn-alice" }],
  ])("returns 400 for a %s", async (_label, override) => {
    const res = await book(booking(override));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Idempotency-Key", () => {
  it("returns the original appointment on retry without creating a duplicate", async () => {
    const headers = { "idempotency-key": "retry-123" };
    const first = await book(booking(), headers);
    const retry = await book(booking(), headers);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(first.json().id);
    expect(ctx.db.select().from(appointments).all()).toHaveLength(1);
  });

  it("rejects reuse of a key with a different request", async () => {
    await book(booking(), { "idempotency-key": "retry-123" });
    const res = await book(booking({ startTime: `${MONDAY}T11:00:00Z` }), { "idempotency-key": "retry-123" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("cancellation", () => {
  it("is idempotent", async () => {
    const { id } = (await book(booking())).json();
    await ctx.app.inject({ method: "POST", url: `/v1/appointments/${id}/cancel` });
    const again = await ctx.app.inject({ method: "POST", url: `/v1/appointments/${id}/cancel` });
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe("CANCELLED");
  });

  it("returns 404 for an unknown appointment", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/v1/appointments/nope/cancel" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/dealerships/:id/availability", () => {
  const availability = (query: string) =>
    ctx.app.inject({ method: "GET", url: `/v1/dealerships/dlr-london/availability?${query}` });

  it("lists slots across opening hours for an empty day", async () => {
    const res = await availability(`serviceTypeId=svc-oil&date=${MONDAY}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ timezone: "Europe/London", durationMinutes: 60 });
    // 08:00 .. 17:00 in 15-minute steps.
    expect(body.slots).toHaveLength(37);
    expect(body.slots[0]).toEqual({
      startTime: `${MONDAY}T08:00:00.000Z`,
      endTime: `${MONDAY}T09:00:00.000Z`,
      availableTechnicians: 2,
      availableBays: 2,
    });
  });

  it("drops slots once both qualified technicians are booked", async () => {
    await book(booking());
    await book(booking({ ...RAJ }));

    const starts = (await availability(`serviceTypeId=svc-oil&date=${MONDAY}`))
      .json()
      .slots.map((s: { startTime: string }) => s.startTime.slice(11, 16));
    expect(starts).toContain("08:00");
    expect(starts).not.toContain("08:15");
    expect(starts).not.toContain("09:45");
    expect(starts).toContain("10:00");
  });

  it("agrees with the booking endpoint: every offered slot can be booked", async () => {
    await book(booking({ ...JANE_LEAF, serviceTypeId: "svc-ev" }));
    const slots = (await availability(`serviceTypeId=svc-ev&date=${MONDAY}`)).json().slots;
    expect(slots.length).toBeGreaterThan(0);
    const res = await book(booking({ ...MARIA, serviceTypeId: "svc-ev", startTime: slots[0].startTime }));
    expect(res.statusCode).toBe(201);
  });

  it("rejects an impossible date", async () => {
    const res = await availability("serviceTypeId=svc-oil&date=2026-02-30");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /v1/dealerships/:id/appointments", () => {
  it("lists the day's appointments in start-time order", async () => {
    await book(booking({ startTime: `${MONDAY}T14:00:00Z` }));
    await book(booking({ ...RAJ, startTime: `${MONDAY}T08:00:00Z` }));
    await book(booking({ ...MARIA, startTime: "2026-11-03T08:00:00Z" }));

    const res = await ctx.app.inject({ method: "GET", url: `/v1/dealerships/dlr-london/appointments?date=${MONDAY}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((a: { startTime: string }) => a.startTime)).toEqual([
      `${MONDAY}T08:00:00.000Z`,
      `${MONDAY}T14:00:00.000Z`,
    ]);
  });
});
