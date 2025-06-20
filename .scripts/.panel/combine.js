const fs = require("fs");
const path = require("path");

const files = ["constants.js", "functions.js", "init.js"];
const baseDir = __dirname;
const outputFile = path.join(__dirname, "..", "..", "panel.js");

const combined = files
  .map(file => fs.readFileSync(path.join(baseDir, file), "utf8"))
  .join("\n\n");

fs.writeFileSync(outputFile, combined);
console.log("✅ panel.js rebuilt from /scripts/panel/");
