-- Link a verified Google OpenID Connect subject to an existing Neon user.
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
