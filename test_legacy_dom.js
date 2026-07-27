/* Tests the document.all fallback used by IE/Windows CE legacy UI. */
var fs = require('fs');
var vm = require('vm');
var path = require('path');
function element(value) { return { value: value || '', innerHTML: '', style: { display: '' }, focus: function(){}, setAttribute: function(){}, scrollTop: 0, scrollHeight: 0 }; }
var elements = {
  terminalOutput: element(''), commandInput: element(''), promptLabel: element(''), shellTable: element(''), editorTable: element(''), editorArea: element(''), editorPathText: element(''), editorModeText: element(''), editorStatus: element(''), editorCommand: element(':'), editorDownload: element(''), shellDownloadArea: element(''), shellDownloadLink: element('')
};
var context = {
  console: console, Math: Math, Date: Date, String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
  document: { getElementById: function(){ return null; }, all: elements, forms: [] },
  location: { protocol: 'http:' },
  setTimeout: function(){},
  open: function(){ return null; }
};
context.window = context;
context.global = context;
vm.createContext(context);
vm.runInContext('Object.prototype.hasOwnProperty = null; Function.prototype.call = null; Array.prototype.sort = null; Array.prototype.shift = null;', context);
['pocketbox-core.js', 'pocketbox-security.js', 'pocketbox-network.js', 'legacy-ui.js'].forEach(function(file){ vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'), context, {filename:file}); });
vm.runInContext('LegacyUI.init(); LegacyUI.quick("ls");', context);
if (elements.terminalOutput.value.indexOf('README.txt') < 0) {
  console.error(elements.terminalOutput.value);
  process.exit(1);
}
console.log('PASS legacy document.all UI fallback and ls');
