export interface ImageToolData {
  imageData: string;
  prompt?: string;
}

export interface ToolResult<T = unknown> {
  toolName?: string;
  message: string;
  data?: T;
}
