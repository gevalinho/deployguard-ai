import { handleDeveloperDeliveryPost } from "@/lib/remediation/developer-delivery-api";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleDeveloperDeliveryPost(request); }
