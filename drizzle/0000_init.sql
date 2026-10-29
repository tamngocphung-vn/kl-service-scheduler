CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`dealership_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`service_type_id` text NOT NULL,
	`technician_id` text NOT NULL,
	`service_bay_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`cancelled_at` integer,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_bay_id`) REFERENCES `service_bays`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_dealership_time_idx` ON `appointments` (`dealership_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_technician_time_idx` ON `appointments` (`technician_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_bay_time_idx` ON `appointments` (`service_bay_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_vehicle_time_idx` ON `appointments` (`vehicle_id`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_idempotency_key_idx` ON `appointments` (`idempotency_key`) WHERE "appointments"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `dealerships` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`opens_at_minute` integer NOT NULL,
	`closes_at_minute` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_bays` (
	`id` text PRIMARY KEY NOT NULL,
	`dealership_id` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `service_bays_dealership_idx` ON `service_bays` (`dealership_id`);--> statement-breakpoint
CREATE TABLE `service_types` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`duration_minutes` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_types_code_unique` ON `service_types` (`code`);--> statement-breakpoint
CREATE TABLE `technician_qualifications` (
	`technician_id` text NOT NULL,
	`service_type_id` text NOT NULL,
	PRIMARY KEY(`technician_id`, `service_type_id`),
	FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tech_qual_service_type_idx` ON `technician_qualifications` (`service_type_id`);--> statement-breakpoint
CREATE TABLE `technicians` (
	`id` text PRIMARY KEY NOT NULL,
	`dealership_id` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `technicians_dealership_idx` ON `technicians` (`dealership_id`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`vin` text NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`year` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_vin_unique` ON `vehicles` (`vin`);--> statement-breakpoint
CREATE INDEX `vehicles_customer_idx` ON `vehicles` (`customer_id`);