import { handleDeveloperDeliveryGet } from "@/lib/remediation/developer-delivery-api";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await context.params;
  return handleDeveloperDeliveryGet(request, deliveryId);
}
