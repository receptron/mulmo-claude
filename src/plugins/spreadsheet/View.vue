<template>
  <div class="spreadsheet-container">
    <div v-if="loading" class="min-h-full p-8 flex items-center justify-center">
      <div class="text-gray-500">Loading spreadsheet...</div>
    </div>
    <div
      v-else-if="errorMessage"
      class="min-h-full p-8 flex items-center justify-center"
    >
      <div class="error">{{ errorMessage }}</div>
    </div>
    <div
      v-else-if="!resolvedSheets || resolvedSheets.length === 0"
      class="min-h-full p-8 flex items-center justify-center"
    >
      <div class="text-gray-500">No spreadsheet data available</div>
    </div>
    <template v-else>
      <div class="spreadsheet-content-wrapper">
        <div class="p-4">
          <div class="header">
            <h1 class="title">
              {{ selectedResult.title || "Spreadsheet" }}
            </h1>
            <div class="button-group">
              <button class="download-btn excel-btn" @click="downloadExcel">
                <span class="material-icons">download</span>
                Excel
              </button>
            </div>
          </div>

          <!-- Sheet tabs (if multiple sheets) -->
          <div v-if="resolvedSheets.length > 1" class="sheet-tabs">
            <button
              v-for="(sheet, index) in resolvedSheets"
              :key="index"
              :class="['sheet-tab', { active: activeSheetIndex === index }]"
              @click="activeSheetIndex = index"
            >
              {{ sheet.name }}
            </button>
          </div>

          <!-- Spreadsheet table -->
          <div
            ref="tableContainer"
            class="table-container"
            @click="handleTableClick"
            v-html="renderedHtml"
          ></div>
        </div>
      </div>

      <!-- Collapsible Editor -->
      <details
        v-if="!miniEditorOpen"
        ref="editorDetails"
        class="spreadsheet-source"
      >
        <summary>Edit Spreadsheet Data</summary>
        <textarea
          ref="editorTextarea"
          v-model="editableData"
          class="spreadsheet-editor"
          spellcheck="false"
          @input="handleDataEdit"
        ></textarea>
        <button class="apply-btn" :disabled="!hasChanges" @click="applyChanges">
          Apply Changes
        </button>
      </details>

      <!-- Mini Editor at Bottom -->
      <div v-if="miniEditorOpen" class="mini-editor-panel">
        <div class="mini-editor-content">
          <span v-if="miniEditorCell" class="cell-ref">
            {{ indexToCol(miniEditorCell.col) }}{{ miniEditorCell.row + 1 }}
          </span>

          <!-- Type Selector -->
          <div class="radio-group">
            <label class="radio-option">
              <input v-model="miniEditorType" type="radio" value="string" />
              String
            </label>
            <label class="radio-option">
              <input v-model="miniEditorType" type="radio" value="object" />
              Formula
            </label>
          </div>

          <!-- String input -->
          <input
            v-if="miniEditorType === 'string'"
            v-model="miniEditorValue"
            type="text"
            class="form-input"
            placeholder="Value"
            @keyup.enter="saveMiniEditor"
          />

          <!-- Formula inputs -->
          <template v-if="miniEditorType === 'object'">
            <input
              v-model="miniEditorFormula"
              type="text"
              class="form-input"
              placeholder="Value or Formula (e.g., 100 or SUM(B2:B11))"
              @keyup.enter="saveMiniEditor"
            />
            <input
              v-model="miniEditorFormat"
              type="text"
              class="form-input"
              placeholder="Format (e.g., $#,##0.00)"
              @keyup.enter="saveMiniEditor"
            />
          </template>

          <button class="save-btn" @click="saveMiniEditor">Update</button>
          <button class="cancel-btn" @click="closeMiniEditor">✕</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import * as XLSX from "xlsx";
import type { ToolResult } from "gui-chat-protocol";
import type { SpreadsheetToolData, SpreadsheetSheet } from "./definition";
import {
  SpreadsheetEngine,
  indexToColumn,
  extractCellReferences,
  buildCellFromInput,
  decodeSpreadsheetResponse,
  findCellJsonPosition,
  type SpreadsheetCell,
  type CellValue,
} from "./engine";
import { applyCellHighlights, clearCellHighlights } from "./cellHighlights";

// Import all spreadsheet functions to populate the function registry
import "./engine/functions";

/**
 * Normalize malformed data structures
 * Some models generate flat arrays instead of 2D arrays - fix them
 */

// Cells can be raw LLM output of arbitrary shape; tightening here would cascade through the engine API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSheetData(data: any): any[][] {
  // Handle null/undefined
  if (!data) {
    return [];
  }

  // If not an array
  if (!Array.isArray(data)) {
    return [];
  }

  // Empty array
  if (data.length === 0) {
    return [];
  }

  // If data is already a 2D array, return as-is
  if (Array.isArray(data[0])) {
    return data;
  }

  // If data is a flat array of cell objects, convert to 2D by pairing cells
  // Pattern: [cell1, cell2, cell3, cell4] -> [[cell1, cell2], [cell3, cell4]]
  if (typeof data[0] === "object" && data[0] !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[][] = [];
    for (let i = 0; i < data.length; i += 2) {
      const row = [data[i]];
      if (i + 1 < data.length) {
        row.push(data[i + 1]);
      }
      rows.push(row);
    }
    return rows;
  }

  // Unknown structure - return empty
  return [];
}

const props = defineProps<{
  selectedResult: ToolResult<SpreadsheetToolData>;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult];
}>();

// Create spreadsheet engine instance
const engine = new SpreadsheetEngine();

const loading = ref(false);
const errorMessage = ref("");
const resolvedSheets = ref<SpreadsheetSheet[]>([]);

function isFilePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("spreadsheets/") &&
    value.endsWith(".json")
  );
}

async function fetchSheets(): Promise<void> {
  const raw = props.selectedResult.data?.sheets;
  // Clear any stale error from a previous result BEFORE the early
  // returns, otherwise switching from a failed file-backed load to
  // a new inline-data result leaves the error panel on screen.
  errorMessage.value = "";
  if (!raw) {
    resolvedSheets.value = [];
    return;
  }
  if (!isFilePath(raw)) {
    // Legacy inline data
    resolvedSheets.value = raw as SpreadsheetSheet[];
    return;
  }
  loading.value = true;
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(raw)}`,
    );
    if (!res.ok) {
      errorMessage.value = `Failed to load spreadsheet: ${res.statusText}`;
      resolvedSheets.value = [];
      return;
    }
    // The /files/content endpoint returns { kind, content?, message? }.
    // Delegate the shape/validation decision to decodeSpreadsheetResponse
    // so the async wrapper stays simple.
    const body: unknown = await res.json();
    const result = decodeSpreadsheetResponse(
      (body as { kind?: string; content?: string; message?: string }) ?? {},
    );
    if (result.kind === "error") {
      errorMessage.value = result.message;
      resolvedSheets.value = [];
    } else {
      resolvedSheets.value = result.sheets as SpreadsheetSheet[];
    }
  } catch (err) {
    errorMessage.value = `Failed to load spreadsheet: ${err instanceof Error ? err.message : "Network error"}`;
    resolvedSheets.value = [];
  } finally {
    loading.value = false;
  }
}

// Fetch on mount and sync editableData
fetchSheets().then(() => {
  editableData.value = JSON.stringify(resolvedSheets.value || [], null, 2);
});

/** Persist edited sheets to disk when file-backed, and emit updateResult. */
async function persistSheets(sheets: SpreadsheetSheet[]): Promise<void> {
  const raw = props.selectedResult.data?.sheets;
  if (isFilePath(raw)) {
    const filename = raw.replace(/^spreadsheets\//, "");
    try {
      const res = await fetch(`/api/spreadsheets/${filename}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets }),
      });
      if (!res.ok) {
        errorMessage.value = `Failed to save spreadsheet: ${res.statusText}`;
        return;
      }
    } catch (err) {
      errorMessage.value = `Failed to save spreadsheet: ${err instanceof Error ? err.message : "Network error"}`;
      return;
    }
  }

  resolvedSheets.value = sheets;

  const updatedResult: ToolResult<SpreadsheetToolData> = {
    ...props.selectedResult,
    data: {
      ...props.selectedResult.data,
      sheets: isFilePath(raw) ? raw : sheets,
    },
  };
  emit("updateResult", updatedResult);
}

const activeSheetIndex = ref(0);
const editableData = ref(JSON.stringify(resolvedSheets.value || [], null, 2));
const editorTextarea = ref<HTMLTextAreaElement | null>(null);
const editorDetails = ref<HTMLDetailsElement | null>(null);
const tableContainer = ref<HTMLDivElement | null>(null);

// Mini editor state
const miniEditorOpen = ref(false);
const miniEditorCell = ref<{ row: number; col: number } | null>(null);

const miniEditorValue = ref<unknown>(null);
const miniEditorType = ref<"number" | "string" | "object">("string");
const miniEditorFormula = ref("");
const miniEditorFormat = ref("");

// Referenced cells state (for formula highlighting)
const referencedCells = ref<Array<{ row: number; col: number }>>([]);

// Check if spreadsheet data has been modified
const hasChanges = computed(() => {
  try {
    const currentData = JSON.stringify(resolvedSheets.value || [], null, 2);
    return editableData.value !== currentData;
  } catch {
    return false;
  }
});

// Short alias used in the template column header.
const indexToCol = indexToColumn;

// Calculate formulas in the data using the spreadsheet engine
const calculateFormulas = (
  data: SpreadsheetCell[][],
  sheetName?: string,
): CellValue[][] => {
  // If we have a sheet name, we need to find all sheets for cross-sheet references
  const allSheets = resolvedSheets.value;

  // Create a SheetData object for the engine
  const sheet = {
    name: sheetName || "Sheet1",
    data,
  };

  // Calculate using the engine
  const result = engine.calculate(sheet, allSheets);

  // Return the calculated data

  return result.data;
};

// Render the active sheet as HTML table
const renderedHtml = computed(() => {
  if (!resolvedSheets.value || resolvedSheets.value.length === 0) {
    return "";
  }

  const sheet = resolvedSheets.value[activeSheetIndex.value];
  if (!sheet || !sheet.data) {
    return "";
  }

  try {
    // Calculate formulas first with sheet name for cross-sheet references
    const calculatedData = calculateFormulas(sheet.data, sheet.name);

    // Convert data array to worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(calculatedData);

    // Generate HTML table
    const html = XLSX.utils.sheet_to_html(worksheet, {
      id: "spreadsheet-table",
      editable: false,
    });

    return html;
  } catch (error) {
    console.error("Failed to render spreadsheet:", error);
    return `<div class="error">Failed to render spreadsheet: ${error instanceof Error ? error.message : "Unknown error"}</div>`;
  }
});

// Download as Excel file
const downloadExcel = () => {
  if (!resolvedSheets.value || resolvedSheets.value.length === 0) return;

  try {
    const workbook = XLSX.utils.book_new();

    // Add all sheets to workbook
    resolvedSheets.value.forEach((sheet) => {
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
    });

    // Generate filename
    const filename = props.selectedResult.title
      ? `${props.selectedResult.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.xlsx`
      : "spreadsheet.xlsx";

    // Write file
    XLSX.writeFile(workbook, filename);
  } catch (error) {
    console.error("Failed to download Excel:", error);
    alert(
      `Failed to download Excel file: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
};

function handleDataEdit() {
  // Just update the local state, don't apply yet
  // User needs to click "Apply Changes" button
}

// `extractCellReferences` now lives in `./engine/formulaRefs.ts`
// (imported at the top of this file). Extracted to bring this
// file's cognitive complexity back under the sonarjs threshold
// and to make the formula-reference scanner unit-testable.
// See `test/plugins/spreadsheet/engine/test_formulaRefs.ts`.

function openMiniEditor(rowIndex: number, colIndex: number) {
  try {
    const sheets = JSON.parse(editableData.value);
    const currentSheet = sheets[activeSheetIndex.value];

    if (!currentSheet || !currentSheet.data) {
      return;
    }

    // Normalize the data in case it's malformed
    const normalizedData = normalizeSheetData(currentSheet.data);

    if (
      !normalizedData[rowIndex] ||
      normalizedData[rowIndex][colIndex] === undefined
    ) {
      return;
    }

    const cellValue = normalizedData[rowIndex][colIndex];

    // Determine cell type and extract values (new format: {v, f})
    if (
      typeof cellValue === "object" &&
      cellValue !== null &&
      "v" in cellValue
    ) {
      const value = cellValue.v;
      const format = cellValue.f ?? "";

      // Check if it's a formula (value starts with "=")
      if (typeof value === "string" && value.startsWith("=")) {
        miniEditorType.value = "object";
        miniEditorValue.value = "";
        miniEditorFormula.value = value.substring(1); // Remove "=" prefix
        miniEditorFormat.value = format;
        // Extract and store referenced cells for highlighting
        referencedCells.value = extractCellReferences(value);
      } else if (typeof value === "number") {
        miniEditorType.value = "object";
        miniEditorValue.value = "";
        miniEditorFormula.value = String(value);
        miniEditorFormat.value = format;
        referencedCells.value = [];
      } else {
        miniEditorType.value = "string";
        miniEditorValue.value = String(value);
        miniEditorFormula.value = "";
        miniEditorFormat.value = "";
        referencedCells.value = [];
      }
    } else {
      // Legacy format or plain value
      miniEditorType.value = "string";
      miniEditorValue.value = String(cellValue ?? "");
      miniEditorFormula.value = "";
      miniEditorFormat.value = "";
      referencedCells.value = [];
    }

    miniEditorCell.value = { row: rowIndex, col: colIndex };
    miniEditorOpen.value = true;
  } catch (error) {
    console.error("Failed to open mini editor:", error);
  }
}

function closeMiniEditor() {
  miniEditorOpen.value = false;
  miniEditorCell.value = null;
  miniEditorValue.value = null;
  miniEditorFormula.value = "";
  miniEditorFormat.value = "";
  referencedCells.value = [];
}

function saveMiniEditor() {
  if (!miniEditorCell.value) return;

  try {
    const sheets = JSON.parse(editableData.value);
    const currentSheet = sheets[activeSheetIndex.value];

    if (!currentSheet || !currentSheet.data) return;

    const { row, col } = miniEditorCell.value;

    // Normalize the data in case it's malformed
    const normalizedData = normalizeSheetData(currentSheet.data);

    // Ensure the row exists
    while (normalizedData.length <= row) {
      normalizedData.push([]);
    }

    // Ensure the row is an array
    if (!Array.isArray(normalizedData[row])) {
      normalizedData[row] = [];
    }

    // Build the new cell value (delegates formula/number detection
    // and format attachment to the pure helper).
    const newCellValue: SpreadsheetCell = buildCellFromInput({
      type: miniEditorType.value,
      value: miniEditorValue.value,
      formula: miniEditorFormula.value,
      format: miniEditorFormat.value,
    });

    // Update the cell in normalized data
    normalizedData[row][col] = newCellValue;

    // Update the sheet with normalized data
    currentSheet.data = normalizedData;

    // Update editableData
    editableData.value = JSON.stringify(sheets, null, 2);

    // Persist to disk (if file-backed) and emit update
    persistSheets(sheets);

    // Update referenced cells if the saved cell contains a formula
    if (typeof newCellValue.v === "string" && newCellValue.v.startsWith("=")) {
      referencedCells.value = extractCellReferences(newCellValue.v);
    } else {
      referencedCells.value = [];
    }

    // Don't close the mini editor - keep it open so user can see the updated references
    // closeMiniEditor();
  } catch (error) {
    alert(
      `Failed to save cell: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

function handleTableClick(event: MouseEvent) {
  const target = event.target as HTMLElement;

  // Check if clicked element is a table cell
  if (target.tagName !== "TD") return;

  // Get the row and column indices
  const cell = target as HTMLTableCellElement;
  const row = cell.parentElement as HTMLTableRowElement;

  const colIndex = cell.cellIndex;
  const rowIndex = row.rowIndex;

  // Check if the main editor details is open
  const isEditorOpen = editorDetails.value?.open ?? false;

  // If editor is closed, open mini editor
  if (!isEditorOpen) {
    openMiniEditor(rowIndex, colIndex);
    return;
  }

  // If editor is open, try to find and select this cell in the editor.
  if (!editorTextarea.value) return;
  try {
    const sheets = JSON.parse(editableData.value);
    const currentSheet = sheets[activeSheetIndex.value];
    if (!currentSheet || !currentSheet.data) return;
    const normalizedData = normalizeSheetData(currentSheet.data);
    if (
      !normalizedData[rowIndex] ||
      normalizedData[rowIndex][colIndex] === undefined
    ) {
      return;
    }
    const cellStr = JSON.stringify(normalizedData[rowIndex][colIndex]);
    const cellStart = findCellJsonPosition(
      editableData.value,
      currentSheet.name,
      rowIndex,
      colIndex,
    );
    if (cellStart < 0) return;
    editorTextarea.value.focus();
    editorTextarea.value.setSelectionRange(
      cellStart,
      cellStart + cellStr.length,
    );
    // Scroll the textarea to make the selection visible.
    const textBeforeSelection = editableData.value.substring(0, cellStart);
    const lineNumber = textBeforeSelection.split("\n").length;
    const lineHeight = 22;
    const textarea = editorTextarea.value;
    textarea.scrollTop = Math.max(
      0,
      lineNumber * lineHeight - textarea.clientHeight / 2,
    );
  } catch (error) {
    console.error("Failed to select cell in editor:", error);
  }
}

async function applyChanges() {
  try {
    // Parse the edited JSON
    const parsedSheets = JSON.parse(editableData.value);

    // Validate it's an array
    if (!Array.isArray(parsedSheets)) {
      throw new Error("Data must be an array of sheets");
    }

    // Persist to disk (if file-backed) and emit update
    await persistSheets(parsedSheets);

    // Reset to first sheet after update
    activeSheetIndex.value = 0;
  } catch (error) {
    alert(
      `Invalid JSON format: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

// Watch for external changes to selectedResult
watch(
  () => props.selectedResult.data?.sheets,
  () => {
    fetchSheets().then(() => {
      editableData.value = JSON.stringify(resolvedSheets.value || [], null, 2);
      // Reset to first sheet when result changes
      activeSheetIndex.value = 0;
    });
  },
);

// Reset active sheet if it's out of bounds
watch(
  () => resolvedSheets.value?.length,
  (length) => {
    if (length && activeSheetIndex.value >= length) {
      activeSheetIndex.value = 0;
    }
  },
);

// Highlight selected cell and referenced cells when mini editor is
// open. The per-step DOM work lives in cellHighlights.ts so this
// callback stays trivial and the complexity lands on the helpers,
// each of which is linear.
watch(
  [miniEditorOpen, miniEditorCell, referencedCells, renderedHtml],
  () => {
    clearCellHighlights(tableContainer.value);
    if (!miniEditorOpen.value) return;
    applyCellHighlights(
      tableContainer.value,
      miniEditorCell.value,
      referencedCells.value,
    );
  },
  { flush: "post" },
);

// Keyboard navigation handler
function handleKeyboardNavigation(event: KeyboardEvent) {
  // Only handle arrow keys when mini editor is open and not focused on input
  if (!miniEditorOpen.value || !miniEditorCell.value) return;

  // Don't interfere if user is typing in an input field
  const target = event.target as HTMLElement;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  ) {
    return;
  }

  const { row, col } = miniEditorCell.value;
  let newRow = row;
  let newCol = col;

  // Determine new position based on arrow key
  switch (event.key) {
    case "ArrowUp":
      newRow = Math.max(0, row - 1);
      break;
    case "ArrowDown":
      newRow = row + 1;
      break;
    case "ArrowLeft":
      newCol = Math.max(0, col - 1);
      break;
    case "ArrowRight":
      newCol = col + 1;
      break;
    default:
      return; // Not an arrow key, ignore
  }

  // Get current sheet data to validate bounds
  try {
    const sheets = JSON.parse(editableData.value);
    const currentSheet = sheets[activeSheetIndex.value];

    if (!currentSheet || !currentSheet.data) return;

    // Validate new position is within bounds
    if (
      newRow < 0 ||
      newRow >= currentSheet.data.length ||
      newCol < 0 ||
      !currentSheet.data[newRow] ||
      newCol >= currentSheet.data[newRow].length
    ) {
      return; // Out of bounds, ignore
    }

    // Prevent default scrolling behavior
    event.preventDefault();

    // Move to new cell
    openMiniEditor(newRow, newCol);
  } catch (error) {
    console.error("Failed to navigate cells:", error);
  }
}

// Add keyboard event listener on mount
onMounted(() => {
  document.addEventListener("keydown", handleKeyboardNavigation);
});

// Remove keyboard event listener on unmount
onUnmounted(() => {
  document.removeEventListener("keydown", handleKeyboardNavigation);
});
</script>

<style scoped>
.spreadsheet-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
}

.spreadsheet-content-wrapper {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1em;
}

.title {
  font-size: 2em;
  margin: 0;
  font-weight: bold;
}

.button-group {
  display: flex;
  gap: 0.5em;
}

.download-btn {
  padding: 0.5em 1em;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 0.5em;
  transition: background-color 0.2s;
}

.excel-btn {
  background-color: #217346;
}

.excel-btn:hover {
  background-color: #1e6a3f;
}

.excel-btn:active {
  background-color: #1a5c36;
}

.download-btn .material-icons {
  font-size: 1.2em;
}

/* Sheet tabs */
.sheet-tabs {
  display: flex;
  gap: 0.25em;
  margin-bottom: 1em;
  border-bottom: 2px solid #e0e0e0;
}

.sheet-tab {
  padding: 0.5em 1em;
  background: #f5f5f5;
  border: none;
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
  color: #666;
  transition: background-color 0.2s;
}

.sheet-tab:hover {
  background: #e8e8e8;
}

.sheet-tab.active {
  background: white;
  color: #333;
  font-weight: 500;
  border-bottom: 2px solid white;
  margin-bottom: -2px;
}

/* Table container */
.table-container {
  overflow-x: auto;
  background: white;
}

/* Style the generated table */
.table-container :deep(table) {
  border-collapse: collapse;
  width: 100%;
  font-family: "Segoe UI", Arial, sans-serif;
  font-size: 0.9em;
}

.table-container :deep(td),
.table-container :deep(th) {
  border: 1px solid #d0d0d0;
  padding: 0.5em 0.75em;
  text-align: left;
}

.table-container :deep(th) {
  background-color: #f5f5f5;
  font-weight: 600;
  color: #333;
}

.table-container :deep(tr:nth-child(even)) {
  background-color: #fafafa;
}

.table-container :deep(tr:hover) {
  background-color: #f0f0f0;
}

.table-container :deep(.cell-editing) {
  background-color: #e8f5e9 !important;
  outline: 2px solid #217346 !important;
  outline-offset: -2px;
}

.table-container :deep(.cell-referenced) {
  background-color: #fff3e0 !important;
  outline: 2px solid #ff9800 !important;
  outline-offset: -2px;
}

/* Error message */
.error {
  padding: 1em;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
  margin: 1em 0;
}

/* Editor section */
.spreadsheet-source {
  padding: 0.5rem;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.spreadsheet-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border-radius: 4px;
  font-weight: 500;
  color: #333;
}

.spreadsheet-source[open] summary {
  margin-bottom: 0.5rem;
}

.spreadsheet-source summary:hover {
  background: #d8d8d8;
}

.spreadsheet-editor {
  width: 100%;
  height: 40vh;
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #ccc;
  border-radius: 4px;
  color: #333;
  font-family: "Courier New", monospace;
  font-size: 0.9rem;
  resize: vertical;
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.spreadsheet-editor:focus {
  outline: none;
  border-color: #217346;
  box-shadow: 0 0 0 2px rgba(33, 115, 70, 0.1);
}

.apply-btn {
  padding: 0.5rem 1rem;
  background: #217346;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
  font-weight: 500;
}

.apply-btn:hover {
  background: #1e6a3f;
}

.apply-btn:active {
  background: #1a5c36;
}

.apply-btn:disabled {
  background: #cccccc;
  color: #666666;
  cursor: not-allowed;
  opacity: 0.6;
}

.apply-btn:disabled:hover {
  background: #cccccc;
}

/* Mini Editor Panel */
.mini-editor-panel {
  background: #f8f8f8;
  border-top: 1px solid #d0d0d0;
  flex-shrink: 0;
}

.mini-editor-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
}

.cell-ref {
  font-family: monospace;
  font-weight: 600;
  color: #217346;
  font-size: 0.85rem;
  min-width: 2rem;
}

.radio-group {
  display: flex;
  gap: 0.75rem;
  border-right: 1px solid #d0d0d0;
  padding-right: 0.75rem;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
  font-size: 0.85rem;
  color: #555;
}

.radio-option input[type="radio"] {
  cursor: pointer;
  width: 0.9rem;
  height: 0.9rem;
}

.form-input {
  flex: 1;
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 0.85rem;
  font-family: inherit;
  transition: border-color 0.2s;
  min-width: 120px;
}

.form-input:focus {
  outline: none;
  border-color: #217346;
  box-shadow: 0 0 0 2px rgba(33, 115, 70, 0.1);
}

.form-input::placeholder {
  color: #999;
  font-size: 0.8rem;
}

.save-btn,
.cancel-btn {
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: background 0.2s;
}

.save-btn {
  background: #217346;
  color: white;
}

.save-btn:hover {
  background: #1e6a3f;
}

.cancel-btn {
  background: transparent;
  color: #666;
  padding: 0.4rem;
  font-size: 1.2rem;
  line-height: 1;
}

.cancel-btn:hover {
  color: #333;
  background: #e0e0e0;
}
</style>
