/* Simulate the missing Object.prototype.hasOwnProperty found in old JScript/Pocket IE. */
var fs = require("fs");
var vm = require("vm");
var source = fs.readFileSync("pocketbox-core.js", "utf8");
var context = { Date: Date, Error: Error, String: String, Number: Number, Math: Math, parseInt: parseInt, isNaN: isNaN };
vm.createContext(context);
vm.runInContext("Object.prototype.hasOwnProperty = null;", context);
vm.runInContext(source, context);
var shell = new context.PocketBox({ host: "pocket-ie4-test", term: "html4" });
var result = shell.execute("ls");
if (result.exitCode !== 0 || result.output.indexOf("README.txt") === -1) {
  console.error("FAIL IE4 ls", result);
  process.exit(1);
}
var longResult = shell.execute("ls -l");
if (longResult.exitCode !== 0 || longResult.output.indexOf("README.txt") === -1) {
  console.error("FAIL IE4 ls -l", longResult);
  process.exit(1);
}
var envResult = shell.execute("env");
if (envResult.exitCode !== 0 || envResult.output.indexOf("HOME=/home/guest") === -1) {
  console.error("FAIL IE4 env", envResult);
  process.exit(1);
}
console.log("PASS Pocket IE 4 compatibility: ls, ls -l, env without hasOwnProperty");
