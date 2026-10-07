/** The required fields mirror the current post-response validators. */
export const architectureResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "deployguard_architecture",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        architectureType: { type: "string" },
        recommendedChecks: { type: "array", items: { type: "string" } },
        risks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              reason: { type: "string" },
              evidenceKeys: { type: "array", items: { type: "string" } },
              researchUrls: { type: "array", items: { type: "string" } },
              inference: { type: "boolean" },
            },
            required: ["title", "severity", "reason", "evidenceKeys", "researchUrls", "inference"],
          },
        },
      },
      required: ["summary", "architectureType", "recommendedChecks", "risks"],
    },
  },
} as const;

export const remediationResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "deployguard_remediation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        actions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              explanation: { type: "string" },
              recommendation: { type: "string" },
              priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
              checkId: { type: "string" },
              evidenceIndexes: { type: "array", items: { type: "integer" } },
            },
            required: ["title", "explanation", "recommendation", "priority", "checkId", "evidenceIndexes"],
          },
        },
      },
      required: ["summary", "actions"],
    },
  },
} as const;
