# Scheduler Calendar View

## Goal

Replace the current list-only Scheduler View with a calendar-based view that supports week and month display modes, while keeping the existing list view accessible.

## Current State

- `src/plugins/scheduler/View.vue` — flat list of `ScheduledItem[]`
- Each item has `title`, `id`, `createdAt`, and `props` (key-value map)
- Date info is stored as `props.date` (ISO string like `"2026-04-07"`) and optionally `props.time`
- Clicking an item opens a YAML editor at the bottom
- A "Edit Source" details section allows raw JSON editing

## Design

### View Modes

Three toggle buttons in the header: **List** | **Week** | **Month**

- **List** — current behavior, unchanged
- **Week** — 7-column grid showing the current week (Mon–Sun), items placed by `props.date`
- **Month** — standard month grid (6 rows × 7 columns), items placed by `props.date`

Items without `props.date` appear in a small "Unscheduled" section below the calendar grid.

### Navigation

- **Prev / Next** buttons to shift the displayed week or month
- **Today** button to jump back to the current week/month
- Header shows the date range (e.g. "Apr 7 – 13, 2026" or "April 2026")

### Calendar Cell

Each day cell shows:
- Day number (bold for today)
- Up to 3 item titles truncated, with "+N more" if overflowing
- Clicking an item selects it and opens the YAML editor (same as list view)
- Today's cell has a subtle blue highlight

### Week View Specifics

- 7 columns, equal width
- Header row: Mon Tue Wed Thu Fri Sat Sun
- Single row of day cells, taller than month cells to show more items
- Time-of-day display if `props.time` exists (e.g. "10:00 Meeting")

### Month View Specifics

- Standard calendar grid, weeks as rows
- Days from adjacent months shown in lighter color
- Compact — show 2-3 items max per cell

## Implementation Plan

### 1. Extract shared state and logic

Move the existing item selection, YAML editor, and API call logic out of the template concerns so it can be shared between list and calendar views.

No new files — keep everything in `View.vue` with clearly separated sections.

### 2. Add view mode state and header controls

- `viewMode` ref: `"list" | "week" | "month"`
- `currentDate` ref: the reference date for navigation (defaults to today)
- Navigation functions: `goToday()`, `goPrev()`, `goNext()`
- Update header to show toggle buttons and navigation

### 3. Implement calendar utilities

Pure functions (no Vue dependency):
- `getWeekDays(date: Date): Date[]` — returns 7 dates for the week containing `date`
- `getMonthGrid(year: number, month: number): Date[][]` — returns 6 rows of 7 dates
- `isToday(date: Date): boolean`
- `isSameDay(a: Date, b: Date): boolean`
- `itemsForDay(items: ScheduledItem[], date: Date): ScheduledItem[]` — filters items by `props.date`

### 4. Build week view template

- 7-column CSS grid
- Map `getWeekDays(currentDate)` to cells
- Each cell renders filtered items for that day
- Items without dates go to "Unscheduled" section

### 5. Build month view template

- 7-column CSS grid, 6 rows
- Map `getMonthGrid(year, month)` to cells
- Adjacent month days styled with `text-gray-300`
- Compact item display with overflow indicator

### 6. Wire up item interaction

- Clicking a calendar item calls `selectItem()` (same as list view)
- YAML editor and source editor remain at the bottom, shared across all views

## Files Changed

| File | Change |
|---|---|
| `src/plugins/scheduler/View.vue` | Add calendar views, view mode toggle, navigation |

## Out of Scope

- Drag-and-drop to reschedule items
- Multi-day event spanning
- Time-slot grid (hour-by-hour view)
- Creating items by clicking empty cells (use chat instead)
