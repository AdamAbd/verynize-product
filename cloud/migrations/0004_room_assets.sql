-- Room assets (cloud/assets.js): images uploaded once to the ASSETS_BUCKET R2 bucket and
-- referenced from the room document by URL. The object key is rooms/<roomId>/<sha256>; one row
-- per room and content hash, so repeated uploads of the same bytes reuse it. "status" is
-- 'pending' until the signed upload arrives, then 'ready'. Times are epoch ms.
create table "room_asset" ("id" text not null primary key, "roomId" text not null, "sha256" text not null, "size" integer not null, "contentType" text not null, "status" text not null, "createdBy" text, "createdAt" integer not null, "uploadedAt" integer, unique ("roomId", "sha256"));

create index "room_asset_roomId_idx" on "room_asset" ("roomId");
