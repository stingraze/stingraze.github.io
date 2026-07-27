/* ES3-style UI for old browsers and Pocket Internet Explorer-class devices. */
var LegacyUI = (function () {
  var shell = null;
  var output = null;
  var input = null;
  var prompt = null;
  var historyIndex = 0;
  var networkBusy = false;

  var shellTable = null;
  var editorTable = null;
  var editorArea = null;
  var editorPathText = null;
  var editorModeText = null;
  var editorStatus = null;
  var editorCommand = null;
  var editorDownload = null;
  var shellDownloadArea = null;
  var shellDownloadLink = null;
  var editorPath = "";
  var editorSavedValue = "";
  var editorMode = "NORMAL";
  var editorPending = "";
  var initialized = false;

  function byId(id) {
    var element = null;
    try {
      if (document.getElementById) {
        element = document.getElementById(id);
      }
    } catch (ignoreGetElement) {
      element = null;
    }
    if (element) {
      return element;
    }
    try {
      if (document.all) {
        element = document.all[id];
      }
    } catch (ignoreDocumentAll) {
      element = null;
    }
    if (element) {
      return element;
    }
    try {
      if (document.forms && document.forms[0] && document.forms[0].elements) {
        element = document.forms[0].elements[id];
      }
    } catch (ignoreForms) {
      element = null;
    }
    return element;
  }

  function append(text) {
    if (!output) {
      return;
    }
    output.value += String(text).replace(/\n/g, "\r\n");
    try {
      output.scrollTop = output.scrollHeight;
    } catch (ignoreScroll) {
      /* Pocket IE may not expose textarea scroll metrics. */
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fileName(path) {
    var slash = path.lastIndexOf("/");
    return slash === -1 ? path : path.substring(slash + 1);
  }

  function updatePrompt() {
    prompt.innerHTML = escapeHtml(shell.prompt());
  }

  function prepareLink(anchor, path, content) {
    var urlApi = window.URL || window.webkitURL;
    var objectUrl = "";
    if (anchor._pocketBoxUrl && urlApi && urlApi.revokeObjectURL) {
      try {
        urlApi.revokeObjectURL(anchor._pocketBoxUrl);
      } catch (ignoreRevoke) {
        // Old browsers may reject object URL cleanup.
      }
      anchor._pocketBoxUrl = "";
    }
    try {
      if (window.Blob && urlApi && urlApi.createObjectURL) {
        objectUrl = urlApi.createObjectURL(new Blob([content], { type: "text/plain" }));
        anchor._pocketBoxUrl = objectUrl;
        anchor.href = objectUrl;
      } else {
        anchor.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
      }
    } catch (ignoreBlob) {
      anchor.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
    }
    try {
      anchor.setAttribute("download", fileName(path) || "pocketbox.txt");
    } catch (ignoreAttribute) {
      // HTML4 browsers may ignore the download attribute and open the file instead.
    }
  }

  function showShellDownload(path, content) {
    shellDownloadArea.style.display = "block";
    shellDownloadLink.innerHTML = "Download / open " + escapeHtml(path);
    prepareLink(shellDownloadLink, path, content);
    append("download link prepared below for " + path + "\n");
  }

  function resolveHttpUrl(value) {
    var raw = String(value || "");
    var anchor;
    var protocol;
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) && !/^\/\//.test(raw)) {
      protocol = String(window.location.protocol || "").toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") {
        throw new Error("relative URLs require HTTP(S); they are disabled from file:// pages");
      }
    }
    anchor = document.createElement("a");
    anchor.href = raw;
    protocol = String(anchor.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      throw new Error("only HTTP and HTTPS requests are supported");
    }
    if (/^https?:\/\/[^\/?#]*@/i.test(anchor.href)) {
      throw new Error("credentials embedded in URLs are not supported");
    }
    return anchor.href;
  }

  function createHttpRequest() {
    var progIds = ["Msxml2.XMLHTTP.6.0", "Msxml2.XMLHTTP.3.0", "Microsoft.XMLHTTP"];
    var i;
    if (window.XMLHttpRequest) {
      try {
        return new XMLHttpRequest();
      } catch (ignoreNative) {
        /* Try ActiveX below. */
      }
    }
    if (window.ActiveXObject) {
      for (i = 0; i < progIds.length; i += 1) {
        try {
          return new ActiveXObject(progIds[i]);
        } catch (ignoreActiveX) {
          /* Try the next historical ProgID. */
        }
      }
    }
    return null;
  }

  function responseHeaderBlock(xhr, status, statusText) {
    var raw = "";
    try {
      raw = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : "";
    } catch (ignore) {
      raw = "";
    }
    return "HTTP " + status + (statusText ? " " + statusText : "") + (raw ? "\n" + raw.replace(/\r\n/g, "\n").replace(/\n+$/, "") : "");
  }

  function finishHttpRequest(request, xhr, failureText) {
    var status = 0;
    var statusText = "";
    var body = "";
    var failed;
    var pieces = [];
    try {
      status = xhr.status === 1223 ? 204 : Number(xhr.status || 0);
    } catch (ignoreStatus) {
      status = 0;
    }
    try {
      statusText = xhr.statusText || "";
    } catch (ignoreStatusText) {
      statusText = "";
    }
    try {
      body = xhr.responseText == null ? "" : String(xhr.responseText);
    } catch (ignoreBody) {
      body = "";
    }
    networkBusy = false;
    try {
      input.disabled = false;
    } catch (ignoreDisabled) {
      /* Some embedded controls do not expose disabled dynamically. */
    }
    if (failureText) {
      append("error: " + failureText + "\n");
      input.focus();
      return;
    }
    if (status === 0) {
      append("error: request blocked or failed; check URL, network, same-origin/CORS, TLS, and mixed-content rules\n");
      input.focus();
      return;
    }
    failed = request.failOnHttpError && status >= 400;
    if (request.includeHeaders) {
      pieces[pieces.length] = responseHeaderBlock(xhr, status, statusText);
    }
    if (failed) {
      pieces[pieces.length] = request.tool + ": HTTP " + status + (statusText ? " " + statusText : "");
      if (body && !request.silent) {
        pieces[pieces.length] = body;
      }
      append(pieces.join("\n\n") + "\n");
      input.focus();
      return;
    }
    if (request.outputPath) {
      try {
        shell.writeFile(request.outputPath, body, false);
        if (!request.silent) {
          pieces[pieces.length] = "saved " + body.length + " bytes to " + request.outputPath + " (HTTP " + status + ")";
        }
      } catch (error) {
        append("error: " + (error.message || String(error)) + "\n");
        input.focus();
        return;
      }
    }
    if (request.printBody && request.method !== "HEAD") {
      pieces[pieces.length] = body;
    }
    if (pieces.length) {
      append(pieces.join("\n\n") + "\n");
    }
    input.focus();
  }

  function performHttpRequest(request) {
    var xhr;
    var url;
    var i;
    if (networkBusy) {
      append("error: another network request is already running\n");
      return;
    }
    try {
      url = resolveHttpUrl(request.url);
      xhr = createHttpRequest();
      if (!xhr) {
        throw new Error("XMLHttpRequest/ActiveX XMLHTTP is unavailable");
      }
      networkBusy = true;
      try {
        input.disabled = true;
      } catch (ignoreDisabled) {
        /* Continue without disabling input. */
      }
      append("requesting " + request.method + " " + url + "\n");
      xhr.open(request.method, url, true);
      try {
        xhr.timeout = request.timeoutMs;
      } catch (ignoreTimeout) {
        /* Old XMLHTTP versions may not have timeout. */
      }
      for (i = 0; i < request.headers.length; i += 1) {
        xhr.setRequestHeader(request.headers[i].name, request.headers[i].value);
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && networkBusy) {
          finishHttpRequest(request, xhr, "");
        }
      };
      try {
        xhr.onerror = function () {
          if (networkBusy) {
            finishHttpRequest(request, xhr, "network or same-origin/CORS error");
          }
        };
        xhr.ontimeout = function () {
          if (networkBusy) {
            finishHttpRequest(request, xhr, "request timed out");
          }
        };
      } catch (ignoreEvents) {
        /* readyState is the baseline completion mechanism. */
      }
      xhr.send(request.body == null ? null : request.body);
      window.setTimeout(function () {
        if (networkBusy) {
          try {
            xhr.abort();
          } catch (ignoreAbort) {
            /* Ignore abort failures. */
          }
          if (networkBusy) {
            finishHttpRequest(request, xhr, "request timed out");
          }
        }
      }, request.timeoutMs + 250);
    } catch (error) {
      networkBusy = false;
      try {
        input.disabled = false;
      } catch (ignoreDisabledAgain) {
        /* Ignore. */
      }
      append("error: " + (error.message || String(error)) + "\n");
      input.focus();
    }
  }

  function run(line) {
    var result;
    if (!shell) {
      if (!init()) {
        return;
      }
    }
    if (networkBusy) {
      append("error: wait for the current network request to finish\n");
      return;
    }
    append(shell.prompt() + line + "\n");
    result = shell.execute(line);
    if (result.clear) {
      output.value = "";
    }
    if (result.output) {
      append(result.output + "\n");
    }
    if (!result.exitCode && result.action === "edit") {
      openEditor(result.path, result.content);
    } else if (!result.exitCode && result.action === "download") {
      showShellDownload(result.path, result.content);
    } else if (!result.exitCode && result.action === "http") {
      performHttpRequest(result.request);
    }
    historyIndex = shell.commandHistory.length;
    updatePrompt();
  }

  function getPosition() {
    if (typeof editorArea.selectionStart === "number") {
      return editorArea.selectionStart;
    }
    return editorArea.value.length;
  }

  function setPosition(position) {
    var range;
    position = Math.max(0, Math.min(editorArea.value.length, position));
    editorArea.focus();
    if (editorArea.setSelectionRange) {
      editorArea.setSelectionRange(position, position);
    } else if (editorArea.createTextRange) {
      range = editorArea.createTextRange();
      range.collapse(true);
      range.moveStart("character", position);
      range.moveEnd("character", 0);
      range.select();
    }
  }

  function setEditorStatus(text) {
    if (text) {
      editorStatus.innerHTML = escapeHtml(text);
    } else if (editorArea.value !== editorSavedValue) {
      editorStatus.innerHTML = "[+] modified";
    } else {
      editorStatus.innerHTML = "ready";
    }
  }

  function setEditorMode(mode) {
    editorMode = mode;
    editorPending = "";
    editorModeText.innerHTML = "-- " + mode + " --";
    try {
      editorArea.readOnly = mode !== "INSERT";
    } catch (ignoreReadonly) {
      // Some embedded browsers do not expose readOnly dynamically.
    }
    editorArea.focus();
  }

  function lineBounds(position) {
    var value = editorArea.value;
    var start = value.lastIndexOf("\n", position - 1) + 1;
    var end = value.indexOf("\n", position);
    if (end === -1) {
      end = value.length;
    }
    return { start: start, end: end };
  }

  function replaceRange(start, end, replacement, cursor) {
    var value = editorArea.value;
    editorArea.value = value.substring(0, start) + replacement + value.substring(end);
    setPosition(typeof cursor === "number" ? cursor : start + replacement.length);
    setEditorStatus("");
  }

  function deleteCharacter() {
    var position = getPosition();
    if (position < editorArea.value.length) {
      replaceRange(position, position + 1, "", position);
    }
  }

  function deleteLine() {
    var value = editorArea.value;
    var bounds = lineBounds(getPosition());
    var start = bounds.start;
    var end = bounds.end;
    if (end < value.length) {
      end += 1;
    } else if (start > 0) {
      start -= 1;
    }
    replaceRange(start, end, "", start);
  }

  function refreshEditorDownload() {
    prepareLink(editorDownload, editorPath, editorArea.value);
  }

  function saveEditor() {
    try {
      shell.writeFile(editorPath, editorArea.value, false);
      editorSavedValue = editorArea.value;
      refreshEditorDownload();
      setEditorStatus('"' + editorPath + '" written (' + editorArea.value.length + " bytes)");
      return true;
    } catch (error) {
      setEditorStatus("error: " + (error.message || String(error)));
      return false;
    }
  }

  function closeEditor(force) {
    if (editorArea.value !== editorSavedValue && !force) {
      setEditorStatus("No write since last change. Use :q! to discard.");
      return false;
    }
    editorTable.style.display = "none";
    shellTable.style.display = "";
    append('closed editor: "' + editorPath + '"\n');
    input.focus();
    return true;
  }

  function openEditor(path, content) {
    editorPath = path;
    editorSavedValue = content;
    editorArea.value = content;
    editorPathText.innerHTML = escapeHtml(path);
    shellTable.style.display = "none";
    editorTable.style.display = "";
    setPosition(0);
    setEditorMode("NORMAL");
    refreshEditorDownload();
    setEditorStatus('"' + path + '" ' + (content ? content.length + " bytes" : "[New File]"));
  }

  function runEditorCommand(raw) {
    var command = String(raw || "").replace(/^\s*:/, "").replace(/^\s+|\s+$/g, "");
    editorCommand.value = "";
    if (command === "w") {
      saveEditor();
    } else if (command === "q") {
      closeEditor(false);
    } else if (command === "q!") {
      closeEditor(true);
    } else if (command === "wq" || command === "x") {
      if (saveEditor()) {
        closeEditor(true);
      }
    } else if (command === "download" || command === "dl") {
      refreshEditorDownload();
      setEditorStatus("download link refreshed");
    } else if (command === "help") {
      setEditorStatus("i insert, Esc normal, h/l, x, dd, :w, :q, :wq, :q!, :download");
    } else if (command) {
      setEditorStatus("Not an editor command: " + command);
    }
    return false;
  }

  function editorKeyDown(eventObject) {
    var eventValue = eventObject || window.event;
    var code;
    if (!eventValue) {
      return true;
    }
    code = eventValue.keyCode || eventValue.which || 0;
    var character = String.fromCharCode(code);
    var position = getPosition();
    if (editorMode === "INSERT") {
      if (code === 27) {
        setEditorMode("NORMAL");
        setEditorStatus("");
        return false;
      }
      return true;
    }
    if (code === 27) {
      editorPending = "";
      return false;
    }
    if (code === 186 || character === ":") {
      editorCommand.value = ":";
      editorCommand.focus();
      return false;
    }
    character = character.toLowerCase();
    if (editorPending === "d") {
      editorPending = "";
      if (character === "d") {
        deleteLine();
        return false;
      }
    }
    if (character === "d") {
      editorPending = "d";
      setEditorStatus("d");
      return false;
    }
    if (character === "i") {
      setEditorMode("INSERT");
      return false;
    }
    if (character === "a") {
      setPosition(position + 1);
      setEditorMode("INSERT");
      return false;
    }
    if (character === "h" || code === 37) {
      setPosition(position - 1);
      return false;
    }
    if (character === "l" || code === 39) {
      setPosition(position + 1);
      return false;
    }
    if (character === "x" || code === 46) {
      deleteCharacter();
      return false;
    }
    return false;
  }

  function editorChanged() {
    setEditorStatus("");
  }

  function openTextWindow() {
    var popup = window.open("", "PocketBoxFile", "resizable=yes,scrollbars=yes");
    if (!popup) {
      setEditorStatus("Popup blocked. Use the Download / open link.");
      return false;
    }
    popup.document.open("text/html");
    popup.document.write("<html><head><title>" + escapeHtml(fileName(editorPath)) + "</title></head><body><pre>" + escapeHtml(editorArea.value) + "</pre></body></html>");
    popup.document.close();
    setEditorStatus("file opened in another window; use Save As");
    return false;
  }

  function init() {
    if (initialized) {
      return true;
    }
    output = byId("terminalOutput");
    input = byId("commandInput");
    prompt = byId("promptLabel");
    shellTable = byId("shellTable");
    editorTable = byId("editorTable");
    editorArea = byId("editorArea");
    editorPathText = byId("editorPathText");
    editorModeText = byId("editorModeText");
    editorStatus = byId("editorStatus");
    editorCommand = byId("editorCommand");
    editorDownload = byId("editorDownload");
    shellDownloadArea = byId("shellDownloadArea");
    shellDownloadLink = byId("shellDownloadLink");
    if (!output || !input || !prompt || !shellTable) {
      try {
        window.status = "PocketBox: required HTML controls were not found";
      } catch (ignoreStatus) {
        /* No status bar available. */
      }
      return false;
    }
    try {
      shell = new PocketBox({ term: "html4", host: "legacy" });
    } catch (startupError) {
      output.value = "PocketBox startup error: " + (startupError.description || startupError.message || String(startupError));
      return false;
    }
    initialized = true;
    append("PocketBox HTML4 / Windows CE compatibility mode\n");
    append(shell.readFile("/etc/motd"));
    updatePrompt();
    try {
      input.focus();
    } catch (ignoreFocus) {
      /* Focus is optional on embedded browsers. */
    }
    return true;
  }

  function submit() {
    var line = input.value;
    input.value = "";
    run(line);
    if (editorTable.style.display === "none") {
      input.focus();
    }
    return false;
  }

  function quick(command) {
    run(command);
    if (editorTable.style.display === "none") {
      input.focus();
    }
  }

  function keyDown(eventObject) {
    var eventValue = eventObject || window.event;
    var code;
    if (!eventValue) {
      return true;
    }
    code = eventValue.keyCode || eventValue.which || 0;
    if (code === 38) {
      if (historyIndex > 0) {
        historyIndex -= 1;
        input.value = shell.commandHistory[historyIndex];
      }
      return false;
    }
    if (code === 40) {
      if (historyIndex < shell.commandHistory.length) {
        historyIndex += 1;
      }
      input.value = historyIndex < shell.commandHistory.length ? shell.commandHistory[historyIndex] : "";
      return false;
    }
    return true;
  }

  return {
    init: init,
    submit: submit,
    quick: quick,
    keyDown: keyDown,
    editorKeyDown: editorKeyDown,
    editorChanged: editorChanged,
    setEditorMode: setEditorMode,
    saveEditor: saveEditor,
    closeEditor: closeEditor,
    runEditorCommand: runEditorCommand,
    refreshEditorDownload: refreshEditorDownload,
    openTextWindow: openTextWindow,
    editorCommandValue: function () { return editorCommand ? editorCommand.value : ":"; }
  };
}());
