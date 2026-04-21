import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentChart";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Save and present one or more Apache ECharts visualizations as a single document. Use this for line, bar, area, scatter, pie, candlestick, heatmap, sankey, or graph/network charts — anything ECharts supports. Pass ECharts option object(s) directly; the plugin calls setOption on each one. Use `charts: []` array form even for a single chart so multi-chart dashboards share the same slug.",
  parameters: {
    type: "object",
    properties: {
      document: {
        type: "object",
        description:
          "Chart document. Contains an optional title and an array of chart entries. Each entry has its own ECharts option object that the UI renders independently.",
        properties: {
          title: {
            type: "string",
            description: "Optional human-friendly title for the whole document. Used to derive the file slug and as the preview label.",
          },
          charts: {
            type: "array",
            description: "List of charts to render, in order. Each charts[i].option is passed as-is to ECharts' setOption().",
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Optional short label for this specific chart (shown above it in the UI).",
                },
                type: {
                  type: "string",
                  description:
                    "Informational tag shown in the UI (e.g. 'line', 'bar', 'candlestick', 'sankey'). The actual chart type is determined by option.series[].type.",
                },
                option: {
                  type: "object",
                  description:
                    "Full ECharts option object. Include all series, axes, tooltip, legend, dataset — anything ECharts accepts. Keep data inline; large datasets are fine.",
                },
              },
              required: ["option"],
            },
          },
        },
        required: ["charts"],
      },
      title: {
        type: "string",
        description: "Short label shown in the canvas preview sidebar. Defaults to document.title, or 'Chart' when both are blank.",
      },
    },
    required: ["document"],
  },
};

export default toolDefinition;
