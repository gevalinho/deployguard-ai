#!/usr/bin/env bash
set -eu

APP="$(systemctl show deployguard.service -p WorkingDirectory --value)"

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "FAIL: Active DeployGuard release directory unavailable" >&2
  exit 1
fi

cd "$APP"

node -r dotenv/config \
  --import tsx \
  --input-type=module -e '
import { PrismaClient } from "./src/generated/prisma/client.ts";

const prisma = new PrismaClient();

try {
  const result = await prisma.$queryRaw`SELECT 1 AS health`;

  if (result[0]?.health !== 1) {
    throw new Error("Unexpected health result");
  }

  console.log("PASS: Supabase PostgreSQL health check");
} catch (error) {
  console.error("FAIL: Supabase PostgreSQL health check");
  console.error("Error code:", error.code ?? "unknown");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
'
