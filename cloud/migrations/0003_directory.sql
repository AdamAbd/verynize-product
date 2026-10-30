-- Account directory moved from the AccountDirectory Durable Object to D1 (cloud/profiles.js).
-- Account ids are the directory's own, so room members, sockets and apps keep their references.
-- "userId" links a profile to its Better Auth user (email + password); legacy passkey or
-- magic-link accounts have none until they sign up with the same verified email. Times are epoch ms.
create table "profile" ("id" text not null primary key, "email" text not null unique, "handle" text not null unique, "displayName" text not null, "avatarUrl" text, "verified" integer not null default 0, "userId" text unique references "user" ("id") on delete set null, "createdAt" integer not null);

create table "room_membership" ("accountId" text not null, "roomId" text not null, "role" text not null, "title" text, "updatedAt" integer not null, primary key ("accountId", "roomId"));

create index "room_membership_roomId_idx" on "room_membership" ("roomId");

create table "publication" ("kind" text not null, "ref" text not null, "accountId" text not null, "title" text not null, "path" text not null, "publishedAt" integer not null, primary key ("kind", "ref"));

create index "publication_accountId_idx" on "publication" ("accountId");

create table "app" ("id" text not null primary key, "accountId" text not null, "name" text not null, "title" text not null, "activeVersion" integer, "createdAt" integer not null, unique ("accountId", "name"));

-- One-time data copies (name 'directory': AccountDirectory → the tables above).
create table "migration_state" ("name" text not null primary key, "state" text not null, "updatedAt" integer not null);
