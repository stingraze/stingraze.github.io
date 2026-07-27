/* Simulates a reduced Windows CE JScript environment for startup and ls. */
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var context = { console: console, Math: Math, Date: Date, String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent };
context.window = context;
context.global = context;
vm.createContext(context);
vm.runInContext('Object.prototype.hasOwnProperty = null; Function.prototype.call = null; Array.prototype.sort = null; Array.prototype.shift = null;', context);
['pocketbox-core.js', 'pocketbox-security.js', 'pocketbox-network.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
});
var result = vm.runInContext('(function(){ var s = new PocketBox({term:"html4",host:"ce"}); return [s.execute("ls").output, s.execute("ls -l").output, s.execute("pwd").output, s.execute("sha256 abc").output, s.execute("wget README.txt").action].join("\\n---\\n"); }())', context);
if (result.indexOf('README.txt') < 0 || result.indexOf('/home/guest') < 0 || result.indexOf('ba7816bf') < 0 || result.indexOf('http') < 0) {
  console.error(result);
  process.exit(1);
}
console.log('PASS IE 5.5/Windows CE reduced-JScript simulation');
console.log(result);
