# Changelog

All notable changes for API consumers. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

- The release version lives in `package.json` and is served as `info.version` in `/docs/json`. Each release is tagged `vX.Y.Z`.
- The URL prefix carries only the **major** version (`/v1`). Backward-compatible additions ship as minor or patch releases under the same prefix. A breaking contract change gets a new prefix (`/v2`, in `src/routes/v2/`) served alongside `/v1` until `/v1` is retired.

## [Unreleased]

## [1.0.0] - 2026-10-29

### Added
- `POST /v1/appointments` books a service appointment for a customer's vehicle, service type, dealership and start time. It confirms only when a qualified technician **and** a service bay are both free for the whole service duration, and assigns both. An optional `Idempotency-Key` header makes retries safe: a replay returns `200` with the original appointment.
- `GET /v1/appointments/{id}` fetches an appointment, and `POST /v1/appointments/{id}/cancel` cancels one (idempotent), releasing its technician and bay.
- `GET /v1/dealerships/{id}/availability` returns bookable start times on a 15-minute grid, and `GET /v1/dealerships/{id}/appointments` returns a day's schedule.
- `GET /v1/dealerships` and `GET /v1/service-types` return reference data.
- Opening hours are applied in each dealership's own timezone. Bookings must start in the future and no more than 90 days ahead.
- Errors share one envelope `{ error: { code, message, details?, requestId } }` with stable codes: `409` for resource conflicts, `422` for business-rule violations.
- Operational endpoints `GET /health`, `GET /ready`, `GET /metrics` (Prometheus) and `GET /docs` (Swagger UI / OpenAPI).

[Unreleased]: https://github.com/tamngocphung-vn/kl-service-scheduler/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tamngocphung-vn/kl-service-scheduler/releases/tag/v1.0.0
