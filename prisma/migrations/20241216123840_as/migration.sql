/*
  Warnings:

  - Added the required column `userId` to the `Interaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN     "userId" TEXT NOT NULL;
