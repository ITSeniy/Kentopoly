import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
const code = ["data.mjs", "engine.mjs", "scene.mjs", "app.mjs"]
  .map((f) =>
    read(f)
      .replace(/^import[\s\S]*?;\s*$/gm, "")
      .replace(/^export /gm, ""),
  )
  .join("\n");
const html = read("index.html")
  .replace(
    '<link rel="stylesheet" href="/style.css">',
    () => "<style>" + read("style.css") + "</style>",
  )
  .replace(
    '<script type="module" src="/app.mjs"></script>',
    () =>
      "<script>window.KENTOPOLY_STANDALONE=true;(()=>{\n" +
      code.replace(/<\/script/gi, "<\\/script") +
      "\n})();</script>",
  );
fs.writeFileSync(path.join(root, "Kentopoly-Table-demo.html"), html);
console.log("Собрано автономное демо: Kentopoly-Table-demo.html");
