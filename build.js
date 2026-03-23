// Build script: reads proxy-config.json (if it exists), updates manifest.json
// allowedDomains, and injects the proxy URL into code.js via esbuild --define.
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
var effectiveProxy = hasValidProxy ? proxyUrl : "";

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

// 2. Run esbuild — inject proxy URL as compile-time constant
console.log("code.js → BUILTIN_PROXY_URL set to " + (effectiveProxy || "(disabled)"));
child.execSync(
  'npx esbuild src/main.ts --bundle --outfile=code.js --format=iife --target=es2020' +
  ' --define:BUILTIN_PROXY_URL=\'"' + effectiveProxy + '"\'',
  { stdio: "inherit" }
);
