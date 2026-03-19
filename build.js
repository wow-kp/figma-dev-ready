// Build script: reads proxy-config.json (if it exists) and injects the proxy
// URL into manifest.json and ui.html, then runs esbuild.
var fs = require("fs");
var child = require("child_process");

var proxyUrl = "";
if (fs.existsSync("proxy-config.json")) {
  try {
    var config = JSON.parse(fs.readFileSync("proxy-config.json", "utf8"));
    proxyUrl = config.proxyUrl || "";
  } catch(e) {
    console.log("Warning: proxy-config.json exists but could not be parsed. Skipping proxy config.");
  }
} else {
  console.log("No proxy-config.json found — building in API-key-only mode. Copy proxy-config.example.json to proxy-config.json to enable proxy.");
}

var proxyDomain = proxyUrl.replace(/^https?:\/\//, "");
var hasValidProxy = proxyUrl && proxyUrl.indexOf("YOUR_SUBDOMAIN") === -1;

// 1. Update manifest.json — allowedDomains
var manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
manifest.networkAccess = manifest.networkAccess || {};
var domains = ["https://api.anthropic.com"];
if (hasValidProxy) {
  domains.unshift("https://" + proxyDomain);
}
manifest.networkAccess.allowedDomains = domains;
fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 4) + "\n");
console.log("manifest.json → allowedDomains set to " + JSON.stringify(domains));

// 2. Update ui.html — _bhProxyUrl variable
var ui = fs.readFileSync("ui.html", "utf8");
ui = ui.replace(
  /var _bhProxyUrl = ".*?";/,
  'var _bhProxyUrl = "' + (hasValidProxy ? proxyUrl : "") + '";'
);
fs.writeFileSync("ui.html", ui);
console.log("ui.html → _bhProxyUrl set to " + (hasValidProxy ? proxyUrl : "(disabled)"));

// 3. Run esbuild
child.execSync("npx esbuild src/main.ts --bundle --outfile=code.js --format=iife --target=es2020", { stdio: "inherit" });
