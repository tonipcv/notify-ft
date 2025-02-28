-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "deviceToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'anônimo',
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_deviceToken_key" ON "DeviceToken"("deviceToken");
