-- Rooms owned by organizations (cloud/orgs.js). The document itself stays in the room's
-- Durable Object; this row decides which organization's members reach it. Times are epoch ms.
create table "room" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete restrict, "title" text not null, "createdBy" text references "user" ("id") on delete set null, "createdAt" integer not null, "updatedAt" integer not null);

create index "room_organizationId_idx" on "room" ("organizationId");
