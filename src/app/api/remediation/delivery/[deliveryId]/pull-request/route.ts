import { handleDeveloperPullRequestPost } from "@/lib/remediation/developer-pull-request-api";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await context.params;
  return handleDeveloperPullRequestPost(request, deliveryId);
}
