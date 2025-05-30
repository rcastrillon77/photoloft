// .scripts/.reservation/combine.js
const fs = require("fs");
const path = require("path");

const baseDir = __dirname;
const files = ["constants.js", "functions.js", "init.js"]; // or dynamically read
const outputFile = path.join(__dirname, "..", "..", "reservation.js");

const combined = files
  .map(file => fs.readFileSync(path.join(baseDir, file), "utf8"))
  .join("\n\n");

fs.writeFileSync(outputFile, combined);
console.log("✅ reservation.js rebuilt from /scripts/reservation/");
