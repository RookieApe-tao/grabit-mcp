import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export function grabitHome() {
    return process.env.GRABIT_HOME || path.join(os.homedir(), ".grabit");
}
export function configFile() {
    return path.join(grabitHome(), "config.json");
}
export function defaultConfig() {
    return {
        binDir: path.join(grabitHome(), "bin"),
        outputDir: path.join(os.homedir(), "Downloads", "grabit"),
    };
}
export function loadConfig() {
    const def = defaultConfig();
    try {
        const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
        return { ...def, ...raw };
    }
    catch {
        return def;
    }
}
export function saveConfig(cfg) {
    fs.mkdirSync(grabitHome(), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), "utf8");
}
export function ensureOutputDir(cfg) {
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    return cfg.outputDir;
}
