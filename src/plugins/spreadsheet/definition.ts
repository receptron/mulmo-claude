import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentSpreadsheet";

export interface SpreadsheetCell {
  v: string | number;
  f?: string;
}

export interface SpreadsheetSheet {
  name: string;
  data: SpreadsheetCell[][];
}

export interface SpreadsheetToolData {
  sheets: SpreadsheetSheet[] | string;
}

export interface SpreadsheetArgs {
  title: string;
  sheets: SpreadsheetSheet[];
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Display an Excel-like spreadsheet with formulas and calculations.",
  prompt: `Use ${TOOL_NAME} when the user asks for a spreadsheet, table with calculations, or what-if analysis. Use formulas and cell references instead of pre-calculated values so the spreadsheet stays interactive. For cell format details and available functions, read \`helps/spreadsheet.md\` in the workspace.`,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title for the spreadsheet",
      },
      sheets: {
        type: "array",
        description: "Sheets to render as spreadsheet tabs. Each sheet includes a name and 2D array of cells (rows x columns).",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Sheet name (e.g., 'Sales Q1', 'Summary')",
            },
            data: {
              type: "array",
              description:
                'Rows of cells. Each cell is an object with \'v\' (value) and \'f\' (format). Use Excel-style A1 notation in formulas: columns are letters (A, B, C...), rows are 1-based numbers (1, 2, 3...). Values can be text, numbers, dates, or formulas. Examples: [{"v": "Product"}, {"v": 2024, "f": "#,##0"}, {"v": "01/15/2025", "f": "MM/DD/YYYY"}, {"v": "=B2*1.05", "f": "$#,##0.00"}]. Format codes: \'$#,##0.00\' (currency), \'#,##0\' (integer), \'0.00%\' (percent), \'0.00\' (decimal), \'MM/DD/YYYY\' (date), \'DD-MMM-YYYY\' (date), \'YYYY-MM-DD\' (ISO date).',
              items: {
                type: "array",
                description: "Row of cells. Each cell is an object with value and format.",
                items: {
                  type: "object",
                  description: "Cell object with value and optional format. If value is a string starting with '=', it's treated as a formula.",
                  properties: {
                    v: {
                      oneOf: [{ type: "string" }, { type: "number" }],
                      description:
                        "Cell value. Can be text, number, date, or formula (string starting with '='). Examples: 'Revenue', 1500000, '01/15/2025', '=SUM(A1:A10)', '=B2-TODAY()'. Date strings like '01/15/2025' are automatically parsed to date serial numbers.",
                    },
                    f: {
                      type: "string",
                      description:
                        "Optional format code for displaying the value. Common formats: '$#,##0.00' (currency), '#,##0' (integer), '0.00%' (percent), '0.00' (decimal), 'MM/DD/YYYY' (date), 'DD-MMM-YYYY' (date), 'YYYY-MM-DD' (ISO date)",
                    },
                  },
                  required: ["v"],
                },
              },
            },
          },
          required: ["name", "data"],
        },
      },
    },
    required: ["title", "sheets"],
  },
};

export default toolDefinition;

export const executeSpreadsheet = async (
  args: SpreadsheetArgs,
): Promise<{
  message: string;
  title: string;
  data: SpreadsheetToolData;
  instructions: string;
}> => {
  const { title } = args;
  let { sheets } = args;

  // Handle case where LLM accidentally stringifies the sheets array
  if (typeof sheets === "string") {
    try {
      sheets = JSON.parse(sheets);
    } catch (error) {
      throw new Error(`Invalid sheets format: sheets must be an array, not a string. Parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Validate that sheets are provided
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error("At least one sheet is required. Sheets must be an array of sheet objects.");
  }

  // Validate each sheet has data
  for (const sheet of sheets) {
    if (!sheet.name || !sheet.data || sheet.data.length === 0) {
      throw new Error(`Invalid sheet: ${sheet.name || "unnamed"}. Each sheet must have a name and data array.`);
    }
  }

  return {
    message: `Created spreadsheet: ${title}`,
    title,
    data: { sheets },
    instructions: "Acknowledge that the spreadsheet has been created and is displayed to the user.",
  };
};
