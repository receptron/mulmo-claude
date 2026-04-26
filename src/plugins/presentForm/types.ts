/**
 * Form Plugin Types
 *
 * Form-specific type definitions only.
 * Common types should be imported directly from gui-chat-protocol.
 */

// ============================================================================
// Form-specific Types
// ============================================================================

/** Field type discriminator */
export type FieldType = "text" | "textarea" | "radio" | "dropdown" | "checkbox" | "date" | "time" | "number";

/** Base field interface */
export interface BaseField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required?: boolean;
  maxLength?: number;
}

/** Text field */
export interface TextField extends BaseField {
  type: "text";
  placeholder?: string;
  validation?: "email" | "url" | "phone" | string;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
}

/** Textarea field */
export interface TextareaField extends BaseField {
  type: "textarea";
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  defaultValue?: string;
}

/** Radio field */
export interface RadioField extends BaseField {
  type: "radio";
  choices: string[];
  defaultValue?: string;
}

/** Dropdown field */
export interface DropdownField extends BaseField {
  type: "dropdown";
  choices: string[];
  searchable?: boolean;
  defaultValue?: string;
}

/** Checkbox field */
export interface CheckboxField extends BaseField {
  type: "checkbox";
  choices: string[];
  minSelections?: number;
  maxSelections?: number;
  defaultValue?: string[];
}

/** Date field */
export interface DateField extends BaseField {
  type: "date";
  minDate?: string;
  maxDate?: string;
  format?: string;
  defaultValue?: string;
}

/** Time field */
export interface TimeField extends BaseField {
  type: "time";
  format?: "12hr" | "24hr";
  defaultValue?: string;
}

/** Number field */
export interface NumberField extends BaseField {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

/** Union type for all fields */
export type FormField = TextField | TextareaField | RadioField | DropdownField | CheckboxField | DateField | TimeField | NumberField;

/** Form data stored in result.jsonData */
export interface FormData {
  title?: string;
  description?: string;
  fields: FormField[];
}

/** Arguments passed to the form tool */
export interface FormArgs {
  title?: string;
  description?: string;
  fields: FormField[];
}
