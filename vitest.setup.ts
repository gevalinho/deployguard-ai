import { beforeEach } from "vitest";

beforeEach(() => {
  process.env.DEPLOYGUARD_PUBLIC_ORIGIN = "https://deployguard.test";
});
