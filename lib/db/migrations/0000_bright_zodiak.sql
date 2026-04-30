CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`github_handle` text,
	`display_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_email_unique` ON `authors` (`email`);--> statement-breakpoint
CREATE TABLE `book_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`manifest_path` text NOT NULL,
	`is_builtin` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`template_id` text,
	`title` text NOT NULL,
	`repo_url` text,
	`repo_local_path` text NOT NULL,
	`default_language` text DEFAULT 'es' NOT NULL,
	`enabled_modes` text DEFAULT '["interviewer"]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `book_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interview_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`name` text NOT NULL,
	`system_prompt` text NOT NULL,
	`intro_md` text,
	`guide_blocks` text NOT NULL,
	`context_files` text DEFAULT '[]' NOT NULL,
	`source_md_path` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `interviewees` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`display_name` text NOT NULL,
	`relation` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`processed_md` text NOT NULL,
	`delivered_md_path` text,
	`delivered_at` integer,
	`approved_by_author` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outputs_session_id_unique` ON `outputs` (`session_id`);--> statement-breakpoint
CREATE TABLE `revoked_tokens` (
	`jti` text PRIMARY KEY NOT NULL,
	`revoked_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`interviewee_id` text NOT NULL,
	`status` text NOT NULL,
	`token_jti` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`current_block_id` text,
	`block_coverage` text,
	`started_at` integer,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `interview_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interviewee_id`) REFERENCES `interviewees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_jti_unique` ON `sessions` (`token_jti`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`role` text NOT NULL,
	`block_id` text,
	`content_text` text,
	`audio_path` text,
	`vetoed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
