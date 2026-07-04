-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "matchedAt" TIMESTAMP(3);

