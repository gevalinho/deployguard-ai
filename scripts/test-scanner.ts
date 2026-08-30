import { scanRepository } from "../src/lib/scanner/repository-scanner";

const repositoryPath = process.cwd();

const result = scanRepository(repositoryPath);

console.log("\n=== DeployGuard Repository Scanner ===\n");
console.log(JSON.stringify(result, null, 2));