# Spreadsheet Authoring Guide

Reference for the `presentSpreadsheet` plugin. Read this before building a spreadsheet.

## Cell Format

Every cell is an object `{"v": value, "f": format}`.

- `v` — value: text, number, date string, or formula (string starting with `=`)
- `f` — optional format code for display

## Formulas

Set `v` to a string starting with `=`. Use Excel-style A1 cell references.

```json
{"v": "=B2*1.05", "f": "$#,##0.00"}
{"v": "=SUM(A1:A10)", "f": "#,##0"}
```

Never pre-calculate — let the spreadsheet compute using cell refs, functions, and arithmetic.

## Available Functions

SUM, AVERAGE, COUNT, MIN, MAX, IF, AND, OR, NOT, ROUND, ABS, TODAY, DATE, DATEDIF, YEAR, MONTH, DAY, CONCATENATE, LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, VLOOKUP, INDEX, MATCH, PMT, FV, PV, NPV, IRR.

## Dates

Use date strings like `01/15/2025` or date formulas like `=TODAY()` or `=DATE(2025,1,15)`. The spreadsheet auto-parses common formats (MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY) into date serial numbers. Date arithmetic works: `=B2-TODAY()` calculates days between dates.

## Format Codes

| Code | Use |
|---|---|
| `$#,##0.00` | Currency |
| `#,##0` | Integer with commas |
| `0.00%` | Percent |
| `0.00` | Decimal |
| `MM/DD/YYYY` | Date |
| `DD-MMM-YYYY` | Date |
| `YYYY-MM-DD` | ISO date |

Format is optional for plain text/numbers.
