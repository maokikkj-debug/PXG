import fs from "node:fs/promises";

function readLocalEnv(path) {
  return fs.readFile(path, "utf8").then((text) => {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !match[1].startsWith("#") && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
    }
  }).catch(() => {});
}
await readLocalEnv(".env.local");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const localConfig = !url || !key ? await import("./config.js") : null;
const finalUrl = url || localConfig?.SUPABASE_URL;
const finalKey = key || localConfig?.SUPABASE_PUBLISHABLE_KEY;
if (!finalUrl || !finalKey) throw new Error("Defina a URL e a chave publicável do Supabase.");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(finalUrl)) {
  throw new Error("SUPABASE_URL inválida.");
}
if (finalKey.includes("service_role") || finalKey.includes("secret")) {
  throw new Error("Use somente a chave publicável no navegador.");
}

await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist", { recursive: true });
for (const file of ["index.html", "main.js", "rules.js", "styles.css"]) {
  await fs.copyFile(file, `dist/${file}`);
}
await fs.writeFile(
  "dist/config.js",
  "export const SUPABASE_URL = " + JSON.stringify(finalUrl) + ";\n" +
  "export const SUPABASE_PUBLISHABLE_KEY = " + JSON.stringify(finalKey) + ";\n"
);
console.log("Build estático pronto em dist.");
