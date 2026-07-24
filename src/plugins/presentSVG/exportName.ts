export const svgExportBaseName = (filePath: string | null): string => {
  if (!filePath) return "drawing";
  const lastSegment = filePath.split("/").pop() ?? "";
  return lastSegment.replace(/\.svg$/i, "") || "drawing";
};
