import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import agentRoutes from "./routes/agent.js";
import todosRoutes from "./routes/todos.js";
import schedulerRoutes from "./routes/scheduler.js";
import sessionsRoutes from "./routes/sessions.js";
import pluginsRoutes from "./routes/plugins.js";
import imageRoutes from "./routes/image.js";
import htmlRoutes from "./routes/html.js";
import rolesRoutes from "./routes/roles.js";
import { initWorkspace } from "./workspace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initWorkspace();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "OK", geminiAvailable: !!process.env.GEMINI_API_KEY });
});

app.use("/api", agentRoutes);
app.use("/api", todosRoutes);
app.use("/api", schedulerRoutes);
app.use("/api", sessionsRoutes);
app.use("/api", pluginsRoutes);
app.use("/api", imageRoutes);
app.use("/api", htmlRoutes);
app.use("/api", rolesRoutes);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client")));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../client/index.html"));
  });
}

app.use((err: Error, _req: Request, res: Response, __next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
