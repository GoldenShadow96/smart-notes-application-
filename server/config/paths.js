import path from "path";
import { fileURLToPath } from "url";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

// __dirname tutaj = .../server/config
// więc root projektu = .../server/config/.. /..
export const projectRoot = path.join(__dirname, "..", "..");

export const staticDir = path.join(projectRoot, "static");
export const templatesDir = path.join(projectRoot, "templates");
