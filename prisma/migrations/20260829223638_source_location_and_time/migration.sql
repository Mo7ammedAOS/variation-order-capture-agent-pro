-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'meeting_online';

-- AlterTable
ALTER TABLE "potential_changes" ADD COLUMN     "source_location" TEXT,
ADD COLUMN     "source_occurred_at" TIMESTAMP(3);

