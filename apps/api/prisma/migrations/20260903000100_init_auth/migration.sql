CREATE SCHEMA IF NOT EXISTS "app";

CREATE TYPE "app"."UserRole" AS ENUM ('user', 'admin');
CREATE TYPE "app"."UserStatus" AS ENUM ('active', 'disabled');

CREATE TABLE "app"."user_account" (
  "id" UUID NOT NULL,
  "username" VARCHAR(32) NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "normalized_email" VARCHAR(254) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "role" "app"."UserRole" NOT NULL DEFAULT 'user',
  "status" "app"."UserStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "last_login_at" TIMESTAMPTZ(3),
  CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."user_session" (
  "id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "csrf_token_hash" CHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_account_username_key"
  ON "app"."user_account"("username");
CREATE UNIQUE INDEX "user_account_normalized_email_key"
  ON "app"."user_account"("normalized_email");
CREATE UNIQUE INDEX "user_session_token_hash_key"
  ON "app"."user_session"("token_hash");
CREATE INDEX "user_session_user_last_seen_idx"
  ON "app"."user_session"("user_id", "last_seen_at");
CREATE INDEX "user_session_idle_expiry_idx"
  ON "app"."user_session"("idle_expires_at");
CREATE INDEX "user_session_absolute_expiry_idx"
  ON "app"."user_session"("absolute_expires_at");

ALTER TABLE "app"."user_session"
  ADD CONSTRAINT "user_session_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app"."user_account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
