CREATE TABLE `datapoints` (
	`id` integer PRIMARY KEY NOT NULL,
	`form` integer NOT NULL,
	`user` integer NOT NULL,
	`administrationId` integer,
	`submitter` text,
	`name` text,
	`geo` text,
	`submitted` integer,
	`duration` real,
	`createdAt` text,
	`submittedAt` text,
	`syncedAt` text,
	`json` text,
	`uuid` text,
	`repeats` text,
	`draftId` integer
);
--> statement-breakpoint
CREATE TABLE `forms` (
	`id` integer PRIMARY KEY NOT NULL,
	`parentId` integer,
	`userId` integer,
	`formId` integer NOT NULL,
	`version` text,
	`latest` integer,
	`name` text,
	`json` text,
	`createdAt` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text,
	`password` text,
	`active` integer,
	`token` text,
	`lastSyncedAt` text
);
