/*
  Warnings:

  - Added the required column `sourceBranch` to the `RemediationDelivery` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RemediationDelivery" ADD COLUMN     "sourceBranch" TEXT NOT NULL;
