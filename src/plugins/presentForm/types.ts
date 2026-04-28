export type FieldType = "text" | "textarea" | "radio" | "dropdown" | "checkbox" | "date" | "time" | "number";

export interface BaseField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required?: boolean;
  maxLength?: number;
}

export interface TextField extends BaseField {
  type: "text";
  placeholder?: string;
  validation?: "email" | "url" | "phone" | string;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
}

export interface TextareaField extends BaseField {
  type: "textarea";
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  defaultValue?: string;
}

export interface RadioField extends BaseField {
  type: "radio";
  choices: string[];
  defaultValue?: string;
}

export interface DropdownField extends BaseField {
  type: "dropdown";
  choices: string[];
  searchable?: boolean;
  defaultValue?: string;
}

export interface CheckboxField extends BaseField {
  type: "checkbox";
  choices: string[];
  minSelections?: number;
  maxSelections?: number;
  defaultValue?: string[];
}

export interface DateField extends BaseField {
  type: "date";
  minDate?: string;
  maxDate?: string;
  format?: string;
  defaultValue?: string;
}

export interface TimeField extends BaseField {
  type: "time";
  format?: "12hr" | "24hr";
  defaultValue?: string;
}

export interface NumberField extends BaseField {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export type FormField = TextField | TextareaField | RadioField | DropdownField | CheckboxField | DateField | TimeField | NumberField;

export interface FormData {
  title?: string;
  description?: string;
  fields: FormField[];
}

export interface FormArgs {
  title?: string;
  description?: string;
  fields: FormField[];
}
