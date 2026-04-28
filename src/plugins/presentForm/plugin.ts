// Forked from @mulmochat-plugin/form so handleSubmit can emit a markdown
// bullet list instead of the upstream JSON-wrapped payload.

import type { ToolContext, ToolResult } from "gui-chat-protocol";
import type { FormData, FormArgs, FormField } from "./types";

export { TOOL_NAME, TOOL_DEFINITION } from "./definition";

function validateChoiceField(field: FormField): void {
  if (field.type === "radio") {
    if (!Array.isArray(field.choices) || field.choices.length < 2) {
      throw new Error(`Field '${field.id}': radio fields must have at least 2 choices`);
    }
    return;
  }
  if (field.type === "dropdown" || field.type === "checkbox") {
    if (!Array.isArray(field.choices) || field.choices.length < 1) {
      throw new Error(`Field '${field.id}': ${field.type} fields must have at least 1 choice`);
    }
  }
}

function validateCheckboxRange(field: FormField & { type: "checkbox" }): void {
  const { minSelections, maxSelections, choices, id } = field;
  if (minSelections !== undefined && maxSelections !== undefined && minSelections > maxSelections) {
    throw new Error(`Field '${id}': minSelections cannot be greater than maxSelections`);
  }
  if (maxSelections !== undefined && maxSelections > choices.length) {
    throw new Error(`Field '${id}': maxSelections cannot exceed number of choices`);
  }
  // Without this, a form would render but be unsubmittable.
  if (minSelections !== undefined && minSelections > choices.length) {
    throw new Error(`Field '${id}': minSelections cannot exceed number of choices`);
  }
}

function validateRangeField(field: FormField): void {
  if (
    (field.type === "text" || field.type === "textarea") &&
    field.minLength !== undefined &&
    field.maxLength !== undefined &&
    field.minLength > field.maxLength
  ) {
    throw new Error(`Field '${field.id}': minLength cannot be greater than maxLength`);
  }
  if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
    throw new Error(`Field '${field.id}': min cannot be greater than max`);
  }
  if (field.type === "date" && field.minDate && field.maxDate && field.minDate > field.maxDate) {
    throw new Error(`Field '${field.id}': minDate cannot be after maxDate`);
  }
  if (field.type === "checkbox") validateCheckboxRange(field);
}

function validateField(field: FormField, index: number, seenIds: Set<string>): void {
  if (!field.id || typeof field.id !== "string") throw new Error(`Field ${index + 1} must have a valid 'id' property`);
  if (!field.type || typeof field.type !== "string") throw new Error(`Field ${index + 1} must have a valid 'type' property`);
  if (!field.label || typeof field.label !== "string") throw new Error(`Field ${index + 1} must have a valid 'label' property`);
  if (seenIds.has(field.id)) throw new Error(`Duplicate field ID: '${field.id}'`);
  seenIds.add(field.id);
  validateChoiceField(field);
  validateRangeField(field);
}

export const executeForm = async (_context: ToolContext, args: FormArgs): Promise<ToolResult<never, FormData>> => {
  try {
    const { title, description, fields } = args;
    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      throw new Error("At least one field is required");
    }
    const seen = new Set<string>();
    fields.forEach((field, i) => validateField(field, i, seen));

    const formData: FormData = { title, description, fields };
    const fieldCount = `${fields.length} field${fields.length > 1 ? "s" : ""}`;
    const titleSuffix = title ? `: ${title}` : "";
    return {
      message: `Form created with ${fieldCount}${titleSuffix}`,
      jsonData: formData,
      instructions:
        "The form has been presented to the user. Wait for the user to fill out and submit it. They will reply with a markdown bullet list of `- {label}: {value}` lines.",
    };
  } catch (error) {
    return {
      message: `Form error: ${error instanceof Error ? error.message : "Unknown error"}`,
      instructions: "Acknowledge that there was an error creating the form and suggest trying again with corrected field definitions.",
    };
  }
};
