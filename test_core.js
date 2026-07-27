/* Run with: node test_core.js (Node is used only as a test runner; the project has no dependencies.) */
var fs = require("fs");
var vm = require("vm");
var source = fs.readFileSync("pocketbox-core.js", "utf8");
var securitySource = fs.readFileSync("pocketbox-security.js", "utf8");
var networkSource = fs.readFileSync("pocketbox-network.js", "utf8");
var context = { Date: Date, Error: Error, String: String, Number: Number, Math: Math, parseInt: parseInt, isNaN: isNaN };
vm.createContext(context);
vm.runInContext(source, context);
vm.runInContext(securitySource, context);
vm.runInContext(networkSource, context);
var shell = new context.PocketBox({ host: "test" });
var failures = 0;

function expect(command, expected) {
  var actual = shell.execute(command).output;
  if (actual !== expected) {
    failures += 1;
    console.error("FAIL", command, "\n expected:", JSON.stringify(expected), "\n actual:  ", JSON.stringify(actual));
  } else {
    console.log("PASS", command);
  }
}

expect("pwd", "/home/guest");
expect("echo hello world", "hello world");
expect("echo hello world | wc -w", "2");
expect("write notes.txt alpha beta", "");
expect("cat notes.txt", "alpha beta\n");
expect("grep beta notes.txt", "alpha beta");
expect("mkdir -p work/a", "");
expect("cd work/a", "");
expect("pwd", "/home/guest/work/a");
expect("echo saved > file.txt", "");
expect("cat file.txt", "saved\n");
expect("echo again >> file.txt", "");
expect("wc -l file.txt", "2");
expect("cd ~", "");
expect("cp notes.txt copy.txt", "");
expect("mv copy.txt moved.txt", "");
expect("cat moved.txt", "alpha beta\n");

var editResult = shell.execute("vi notes.txt");
if (editResult.exitCode !== 0 || editResult.action !== "edit" || editResult.path !== "/home/guest/notes.txt" || editResult.content !== "alpha beta\n") {
  failures += 1;
  console.error("FAIL vi action", editResult);
} else {
  console.log("PASS vi action");
}

var newEditResult = shell.execute("vim draft.txt");
if (newEditResult.exitCode !== 0 || newEditResult.action !== "edit" || newEditResult.path !== "/home/guest/draft.txt" || newEditResult.content !== "") {
  failures += 1;
  console.error("FAIL vim new file action", newEditResult);
} else {
  console.log("PASS vim new file action");
}

var downloadResult = shell.execute("download notes.txt");
if (downloadResult.exitCode !== 0 || downloadResult.action !== "download" || downloadResult.content !== "alpha beta\n") {
  failures += 1;
  console.error("FAIL download action", downloadResult);
} else {
  console.log("PASS download action");
}


expect("md5 abc", "900150983cd24fb0d6963f7d28e17f72");
expect("sha1 abc", "a9993e364706816aba3e25717850c26c9cd0d89d");
expect("sha256 abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
expect("crc32 123456789", "cbf43926");
expect("fnv1a hello", "4f9f2cab");
expect("base64 hello", "aGVsbG8=");
expect("base64 -d aGVsbG8=", "hello");
expect("hex hello", "68656c6c6f");
expect("hex -d 68656c6c6f", "hello");
expect("urlencode hello world", "hello%20world");
expect("urldecode hello%20world", "hello world");
expect("rot13 uryyb", "hello");
expect("echo admin | sha256", "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918");

var ipResult = shell.execute("ipcalc 192.168.10.25/24").output;
if (ipResult.indexOf("Network: 192.168.10.0") === -1 || ipResult.indexOf("Broadcast: 192.168.10.255") === -1) {
  failures += 1;
  console.error("FAIL ipcalc", ipResult);
} else {
  console.log("PASS ipcalc");
}

var securityDoc = shell.execute("cat /docs/SECURITY.txt").output;
if (securityDoc.indexOf("Offline Security Toolkit") === -1) {
  failures += 1;
  console.error("FAIL security documentation");
} else {
  console.log("PASS security documentation");
}

var headerResult = shell.execute("write /tmp/headers.txt HTTP/1.1 200 OK").output;
shell.writeFile("/tmp/headers.txt", "HTTP/1.1 200 OK\nContent-Security-Policy: default-src 'self'\nX-Content-Type-Options: nosniff\n", false);
headerResult = shell.execute("headercheck -f /tmp/headers.txt").output;
if (headerResult.indexOf("[OK] Content-Security-Policy present") === -1 || headerResult.indexOf("[OK] X-Content-Type-Options: nosniff") === -1) {
  failures += 1;
  console.error("FAIL headercheck", headerResult);
} else {
  console.log("PASS headercheck");
}

var curlResult = shell.execute("curl -i -H \"Accept: application/json\" -o /tmp/result.json https://example.com/api");
if (curlResult.exitCode !== 0 || curlResult.action !== "http" || !curlResult.request || curlResult.request.tool !== "curl" || curlResult.request.outputPath !== "/tmp/result.json" || curlResult.request.headers.length !== 1 || !curlResult.request.includeHeaders) {
  failures += 1;
  console.error("FAIL curl action", curlResult);
} else {
  console.log("PASS curl action");
}

var curlHeadResult = shell.execute("curl -I --max-time 5 https://example.com/");
if (curlHeadResult.exitCode !== 0 || curlHeadResult.request.method !== "HEAD" || curlHeadResult.request.timeoutMs !== 5000 || curlHeadResult.request.printBody !== false) {
  failures += 1;
  console.error("FAIL curl head action", curlHeadResult);
} else {
  console.log("PASS curl head action");
}

var curlDataResult = shell.execute("curl -d @notes.txt https://example.com/submit");
if (curlDataResult.exitCode !== 0 || curlDataResult.request.method !== "POST" || curlDataResult.request.body !== "alpha beta\n") {
  failures += 1;
  console.error("FAIL curl data action", curlDataResult);
} else {
  console.log("PASS curl data action");
}

var wgetResult = shell.execute("wget https://example.com/files/report.txt?download=1");
if (wgetResult.exitCode !== 0 || wgetResult.action !== "http" || wgetResult.request.tool !== "wget" || wgetResult.request.outputPath !== "/home/guest/report.txt") {
  failures += 1;
  console.error("FAIL wget action", wgetResult);
} else {
  console.log("PASS wget action");
}

var wgetStdoutResult = shell.execute("wget -O - README.md");
if (wgetStdoutResult.exitCode !== 0 || wgetStdoutResult.request.outputPath !== "" || wgetStdoutResult.request.printBody !== true) {
  failures += 1;
  console.error("FAIL wget stdout action", wgetStdoutResult);
} else {
  console.log("PASS wget stdout action");
}

var insecureResult = shell.execute("curl -k https://example.com/");
if (insecureResult.exitCode !== 1 || insecureResult.output.indexOf("disable TLS verification") === -1) {
  failures += 1;
  console.error("FAIL curl insecure refusal", insecureResult);
} else {
  console.log("PASS curl insecure refusal");
}

var networkDoc = shell.execute("cat /docs/NETWORK.txt").output;
if (networkDoc.indexOf("Browser Network Tools") === -1) {
  failures += 1;
  console.error("FAIL network documentation");
} else {
  console.log("PASS network documentation");
}

if (failures) {
  process.exit(1);
}
console.log("All tests passed.");
