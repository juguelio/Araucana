-- Supabase Auth replaces the application's password and opaque session store.
ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" ADD COLUMN "supabaseUserId" TEXT;
ALTER TABLE "User" ALTER COLUMN "isActive" SET DEFAULT false;

DROP TABLE "Session";

CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");
