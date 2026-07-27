(function () {
  "use strict";

  var shell = new PocketBox({ term: "html5", host: "mobile" });
  var output;
  var commandInput;
  var promptLabel;
  var statusText;
  var historyIndex = 0;
  var storageKey = "pocketbox-shell-state-v1";
  var networkBusy = false;

  var editorOverlay;
  var editorArea;
  var editorModeLabel;
  var editorPathLabel;
  var editorStatus;
  var editorCommand;
  var editorDownloadLink;
  var editorPath = "";
  var editorMode = "NORMAL";
  var editorSavedValue = "";
  var editorUndo = [];
  var editorPending = "";

  function textNode(text) {
    return document.createTextNode(text);
  }

  function scrollToBottom() {
    output.scrollTop = output.scrollHeight;
  }

  function addLine(text, className) {
    var line = document.createElement("div");
    line.className = className || "line";
    line.appendChild(textNode(text));
    output.appendChild(line);
    scrollToBottom();
  }

  function fileName(path) {
    var slash = path.lastIndexOf("/");
    return slash === -1 ? path : path.substring(slash + 1);
  }

  function makeDownload(anchor, path, content) {
    var urlApi = window.URL || window.webkitURL;
    var objectUrl = "";
    if (anchor._pocketBoxUrl && urlApi && urlApi.revokeObjectURL) {
      urlApi.revokeObjectURL(anchor._pocketBoxUrl);
      anchor._pocketBoxUrl = "";
    }
    try {
      if (window.Blob && urlApi && urlApi.createObjectURL) {
        objectUrl = urlApi.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
        anchor._pocketBoxUrl = objectUrl;
        anchor.href = objectUrl;
      } else {
        anchor.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
      }
    } catch (ignore) {
      anchor.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
    }
    anchor.setAttribute("download", fileName(path) || "pocketbox.txt");
  }

  function addDownloadLine(path, content) {
    var line = document.createElement("div");
    var link = document.createElement("a");
    line.className = "line download-line";
    link.appendChild(textNode("Download " + path));
    makeDownload(link, path, content);
    line.appendChild(link);
    output.appendChild(line);
    scrollToBottom();
  }

  function updatePrompt() {
    promptLabel.textContent = shell.prompt();
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function saveState() {
    try {
      if (window.localStorage && window.JSON) {
        window.localStorage.setItem(storageKey, JSON.stringify(shell.snapshot()));
        setStatus("saved locally");
      }
    } catch (ignore) {
      setStatus("local save unavailable");
    }
  }

  function loadState() {
    var stored;
    try {
      if (window.localStorage && window.JSON) {
        stored = window.localStorage.getItem(storageKey);
        if (stored) {
          shell.restoreSnapshot(JSON.parse(stored));
          setStatus("restored local state");
          return true;
        }
      }
    } catch (ignore) {
      setStatus("started with fresh state");
    }
    return false;
  }

  function resolveHttpUrl(value) {
    var raw = String(value || "");
    var anchor;
    var protocol;
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) && !/^\/\//.test(raw)) {
      protocol = String(window.location.protocol || "").toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") {
        throw new Error("relative URLs require PocketBox to be served over HTTP(S), not opened with file://");
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
    if (window.XMLHttpRequest) {
      return new XMLHttpRequest();
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
    var headers = "";
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
    commandInput.disabled = false;
    setStatus("ready");

    if (failureText) {
      addLine("error: " + failureText, "line error-line");
      commandInput.focus();
      return;
    }
    if (status === 0) {
      addLine("error: request blocked or failed. Check the URL, network, CORS policy, CSP, and mixed-content rules.", "line error-line");
      commandInput.focus();
      return;
    }
    failed = request.failOnHttpError && status >= 400;
    headers = responseHeaderBlock(xhr, status, statusText);
    if (request.includeHeaders) {
      pieces[pieces.length] = headers;
    }
    if (failed) {
      pieces[pieces.length] = request.tool + ": HTTP " + status + (statusText ? " " + statusText : "");
      if (body && !request.silent) {
        pieces[pieces.length] = body;
      }
      addLine(pieces.join("\n\n"), "line error-line");
      commandInput.focus();
      return;
    }
    if (request.outputPath) {
      try {
        shell.writeFile(request.outputPath, body, false);
        saveState();
        if (!request.silent) {
          pieces[pieces.length] = "saved " + body.length + " bytes to " + request.outputPath + " (HTTP " + status + ")";
        }
      } catch (error) {
        addLine("error: " + (error.message || String(error)), "line error-line");
        commandInput.focus();
        return;
      }
    }
    if (request.printBody && request.method !== "HEAD") {
      pieces[pieces.length] = body;
    }
    if (pieces.length) {
      addLine(pieces.join("\n\n"), "line output-line");
    }
    commandInput.focus();
  }

  function performHttpRequest(request) {
    var xhr;
    var url;
    var i;
    if (networkBusy) {
      addLine("error: another network request is already running", "line error-line");
      return;
    }
    try {
      url = resolveHttpUrl(request.url);
      xhr = createHttpRequest();
      if (!xhr) {
        throw new Error("XMLHttpRequest is unavailable in this browser");
      }
      networkBusy = true;
      commandInput.disabled = true;
      setStatus(request.method + " " + url);
      xhr.open(request.method, url, true);
      try {
        xhr.timeout = request.timeoutMs;
      } catch (ignoreTimeout) {
        /* Timeout is optional on older engines. */
      }
      for (i = 0; i < request.headers.length; i += 1) {
        xhr.setRequestHeader(request.headers[i].name, request.headers[i].value);
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && networkBusy) {
          finishHttpRequest(request, xhr, "");
        }
      };
      xhr.onerror = function () {
        if (networkBusy) {
          finishHttpRequest(request, xhr, "network or CORS error");
        }
      };
      xhr.ontimeout = function () {
        if (networkBusy) {
          finishHttpRequest(request, xhr, "request timed out");
        }
      };
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
      commandInput.disabled = false;
      setStatus("ready");
      addLine("error: " + (error.message || String(error)), "line error-line");
      commandInput.focus();
    }
  }

  function runCommand(line) {
    var result;
    if (networkBusy) {
      addLine("error: wait for the current network request to finish", "line error-line");
      return;
    }
    var prompt = shell.prompt();
    addLine(prompt + line, "line command-line");
    result = shell.execute(line);
    if (result.clear) {
      output.innerHTML = "";
    }
    if (result.output) {
      addLine(result.output, result.exitCode ? "line error-line" : "line output-line");
    }
    if (!result.exitCode && result.action === "edit") {
      openEditor(result.path, result.content);
    } else if (!result.exitCode && result.action === "download") {
      addDownloadLine(result.path, result.content);
    } else if (!result.exitCode && result.action === "http") {
      performHttpRequest(result.request);
    }
    historyIndex = shell.commandHistory.length;
    updatePrompt();
    saveState();
  }

  function submit(event) {
    var line = commandInput.value;
    if (event && event.preventDefault) {
      event.preventDefault();
    }
    commandInput.value = "";
    runCommand(line);
    if (editorOverlay.hidden) {
      commandInput.focus();
    }
    return false;
  }

  function historyMove(direction) {
    if (!shell.commandHistory.length) {
      return;
    }
    historyIndex += direction;
    if (historyIndex < 0) {
      historyIndex = 0;
    }
    if (historyIndex > shell.commandHistory.length) {
      historyIndex = shell.commandHistory.length;
    }
    commandInput.value = historyIndex === shell.commandHistory.length ? "" : shell.commandHistory[historyIndex];
    window.setTimeout(function () {
      commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
    }, 0);
  }

  function bindQuickCommands() {
    var buttons = document.querySelectorAll("[data-command]");
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function () {
        runCommand(this.getAttribute("data-command"));
        if (editorOverlay.hidden) {
          commandInput.focus();
        }
      }, false);
    }
  }

  function editorDirty() {
    return editorArea.value !== editorSavedValue;
  }

  function setEditorStatus(text) {
    editorStatus.textContent = text || (editorDirty() ? "[+] modified" : "ready");
  }

  function setEditorMode(mode) {
    editorMode = mode;
    editorModeLabel.textContent = "-- " + mode + " --";
    editorModeLabel.className = "editor-mode " + mode.toLowerCase() + "-mode";
    editorArea.readOnly = mode !== "INSERT";
    editorPending = "";
    editorArea.focus();
  }

  function editorSelection(start, end) {
    var length = editorArea.value.length;
    start = Math.max(0, Math.min(length, start));
    end = typeof end === "number" ? Math.max(start, Math.min(length, end)) : start;
    editorArea.focus();
    editorArea.setSelectionRange(start, end);
  }

  function pushUndo() {
    editorUndo.push({ value: editorArea.value, position: editorArea.selectionStart });
    if (editorUndo.length > 50) {
      editorUndo.shift();
    }
  }

  function undoEditor() {
    var state = editorUndo.pop();
    if (!state) {
      setEditorStatus("Already at oldest change");
      return;
    }
    editorArea.value = state.value;
    editorSelection(state.position);
    setEditorStatus("1 change undone");
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

  function moveVertical(direction) {
    var value = editorArea.value;
    var position = editorArea.selectionStart;
    var current = lineBounds(position);
    var column = position - current.start;
    var targetStart;
    var targetEnd;
    if (direction < 0) {
      if (current.start === 0) {
        return;
      }
      targetEnd = current.start - 1;
      targetStart = value.lastIndexOf("\n", Math.max(0, targetEnd - 1)) + 1;
    } else {
      if (current.end >= value.length) {
        return;
      }
      targetStart = current.end + 1;
      targetEnd = value.indexOf("\n", targetStart);
      if (targetEnd === -1) {
        targetEnd = value.length;
      }
    }
    editorSelection(Math.min(targetStart + column, targetEnd));
  }

  function moveWord(direction) {
    var value = editorArea.value;
    var position = editorArea.selectionStart;
    if (direction > 0) {
      while (position < value.length && /\w/.test(value.charAt(position))) {
        position += 1;
      }
      while (position < value.length && !/\w/.test(value.charAt(position))) {
        position += 1;
      }
    } else {
      position = Math.max(0, position - 1);
      while (position > 0 && !/\w/.test(value.charAt(position))) {
        position -= 1;
      }
      while (position > 0 && /\w/.test(value.charAt(position - 1))) {
        position -= 1;
      }
    }
    editorSelection(position);
  }

  function replaceRange(start, end, replacement, cursor) {
    var value = editorArea.value;
    pushUndo();
    editorArea.value = value.substring(0, start) + replacement + value.substring(end);
    editorSelection(typeof cursor === "number" ? cursor : start + replacement.length);
    setEditorStatus("");
  }

  function deleteCharacter() {
    var start = editorArea.selectionStart;
    var end = editorArea.selectionEnd;
    if (start === end) {
      end = Math.min(editorArea.value.length, start + 1);
    }
    if (start !== end) {
      replaceRange(start, end, "", start);
    }
  }

  function deleteLine() {
    var value = editorArea.value;
    var bounds = lineBounds(editorArea.selectionStart);
    var start = bounds.start;
    var end = bounds.end;
    if (end < value.length) {
      end += 1;
    } else if (start > 0) {
      start -= 1;
    }
    replaceRange(start, end, "", Math.min(start, Math.max(0, value.length - (end - start))));
  }

  function openLine(below) {
    var bounds = lineBounds(editorArea.selectionStart);
    var position = below ? bounds.end : bounds.start;
    var text = below ? "\n" : "\n";
    pushUndo();
    editorArea.value = editorArea.value.substring(0, position) + text + editorArea.value.substring(position);
    editorSelection(below ? position + 1 : position);
    setEditorMode("INSERT");
    setEditorStatus("");
  }

  function enterInsert(position) {
    pushUndo();
    editorSelection(position);
    setEditorMode("INSERT");
  }

  function saveEditor() {
    try {
      shell.writeFile(editorPath, editorArea.value, false);
      editorSavedValue = editorArea.value;
      saveState();
      refreshEditorDownload();
      setEditorStatus('"' + editorPath + '" written (' + editorArea.value.length + " bytes)");
      return true;
    } catch (error) {
      setEditorStatus("error: " + error.message);
      return false;
    }
  }

  function refreshEditorDownload() {
    makeDownload(editorDownloadLink, editorPath, editorArea.value);
  }

  function closeEditor(force) {
    if (editorDirty() && !force) {
      setEditorStatus("No write since last change (use :q! to discard)");
      return false;
    }
    editorOverlay.hidden = true;
    document.body.classList.remove("editor-open");
    addLine('closed editor: "' + editorPath + '"', "line banner-line");
    commandInput.focus();
    return true;
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
      editorDownloadLink.click();
      setEditorStatus("download prepared");
    } else if (command === "help") {
      setEditorStatus("i insert | Esc normal | h j k l | w b | x | dd | u | :w :q :wq :q! :download");
    } else if (command) {
      setEditorStatus("Not an editor command: " + command);
    }
    if (!editorOverlay.hidden && command !== "q" && command !== "q!" && command !== "wq" && command !== "x") {
      editorArea.focus();
    }
  }

  function openEditor(path, content) {
    editorPath = path;
    editorSavedValue = content;
    editorArea.value = content;
    editorUndo = [];
    editorPathLabel.textContent = path;
    editorOverlay.hidden = false;
    document.body.classList.add("editor-open");
    editorSelection(0);
    setEditorMode("NORMAL");
    refreshEditorDownload();
    setEditorStatus('"' + path + '" ' + (content ? content.length + " bytes" : "[New File]"));
  }

  function normalKey(event) {
    var key = event.key;
    var position = editorArea.selectionStart;
    var bounds;
    if (key === "Escape") {
      event.preventDefault();
      editorPending = "";
      return;
    }
    if (key === ":") {
      event.preventDefault();
      editorCommand.value = ":";
      editorCommand.focus();
      editorCommand.setSelectionRange(1, 1);
      return;
    }
    if (editorPending === "g") {
      editorPending = "";
      if (key === "g") {
        event.preventDefault();
        editorSelection(0);
        return;
      }
    } else if (editorPending === "d") {
      editorPending = "";
      if (key === "d") {
        event.preventDefault();
        deleteLine();
        return;
      }
    }
    if (key === "g" || key === "d") {
      event.preventDefault();
      editorPending = key;
      setEditorStatus(key === "g" ? "g" : "d");
      return;
    }
    if (key === "i") {
      event.preventDefault();
      enterInsert(position);
    } else if (key === "a") {
      event.preventDefault();
      enterInsert(Math.min(editorArea.value.length, position + 1));
    } else if (key === "I") {
      event.preventDefault();
      enterInsert(lineBounds(position).start);
    } else if (key === "A") {
      event.preventDefault();
      enterInsert(lineBounds(position).end);
    } else if (key === "o") {
      event.preventDefault();
      openLine(true);
    } else if (key === "O") {
      event.preventDefault();
      openLine(false);
    } else if (key === "h" || key === "ArrowLeft") {
      event.preventDefault();
      editorSelection(position - 1);
    } else if (key === "l" || key === "ArrowRight") {
      event.preventDefault();
      editorSelection(position + 1);
    } else if (key === "j" || key === "ArrowDown") {
      event.preventDefault();
      moveVertical(1);
    } else if (key === "k" || key === "ArrowUp") {
      event.preventDefault();
      moveVertical(-1);
    } else if (key === "0" || key === "Home") {
      event.preventDefault();
      editorSelection(lineBounds(position).start);
    } else if (key === "$" || key === "End") {
      event.preventDefault();
      editorSelection(lineBounds(position).end);
    } else if (key === "G") {
      event.preventDefault();
      editorSelection(editorArea.value.length);
    } else if (key === "w") {
      event.preventDefault();
      moveWord(1);
    } else if (key === "b") {
      event.preventDefault();
      moveWord(-1);
    } else if (key === "x" || key === "Delete") {
      event.preventDefault();
      deleteCharacter();
    } else if (key === "u") {
      event.preventDefault();
      undoEditor();
    } else if (key === "Enter") {
      event.preventDefault();
      bounds = lineBounds(position);
      editorSelection(bounds.end < editorArea.value.length ? bounds.end + 1 : bounds.end);
    }
  }

  function bindEditor() {
    editorArea.addEventListener("keydown", function (event) {
      if (editorMode === "INSERT") {
        if (event.key === "Escape" || (event.ctrlKey && event.key === "[")) {
          event.preventDefault();
          setEditorMode("NORMAL");
          setEditorStatus("");
        }
      } else {
        normalKey(event);
      }
    }, false);

    editorArea.addEventListener("input", function () {
      setEditorStatus("");
    }, false);

    document.getElementById("editor-insert-button").addEventListener("click", function () {
      enterInsert(editorArea.selectionStart);
    }, false);
    document.getElementById("editor-normal-button").addEventListener("click", function () {
      setEditorMode("NORMAL");
    }, false);
    document.getElementById("editor-save-button").addEventListener("click", saveEditor, false);
    document.getElementById("editor-close-button").addEventListener("click", function () {
      closeEditor(false);
    }, false);
    editorDownloadLink.addEventListener("click", function () {
      refreshEditorDownload();
      setEditorStatus("downloading current buffer");
    }, false);
    document.getElementById("editor-command-form").addEventListener("submit", function (event) {
      event.preventDefault();
      runEditorCommand(editorCommand.value);
    }, false);
  }

  function init() {
    output = document.getElementById("terminal-output");
    commandInput = document.getElementById("command-input");
    promptLabel = document.getElementById("prompt-label");
    statusText = document.getElementById("status-text");

    editorOverlay = document.getElementById("editor-overlay");
    editorArea = document.getElementById("editor-area");
    editorModeLabel = document.getElementById("editor-mode-label");
    editorPathLabel = document.getElementById("editor-path-label");
    editorStatus = document.getElementById("editor-status");
    editorCommand = document.getElementById("editor-command");
    editorDownloadLink = document.getElementById("editor-download-link");

    loadState();
    addLine("PocketBox HTML5 mode", "line banner-line");
    addLine(shell.readFile("/etc/motd"), "line output-line");
    updatePrompt();

    document.getElementById("command-form").addEventListener("submit", submit, false);
    commandInput.addEventListener("keydown", function (event) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        historyMove(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        historyMove(1);
      } else if (event.key === "l" && event.ctrlKey) {
        event.preventDefault();
        runCommand("clear");
      }
    }, false);

    document.getElementById("theme-button").addEventListener("click", function () {
      document.body.classList.toggle("light-theme");
      commandInput.focus();
    }, false);

    document.getElementById("erase-button").addEventListener("click", function () {
      try {
        window.localStorage.removeItem(storageKey);
      } catch (ignore) {
        // Ignore storage failures.
      }
      shell.resetFileSystem();
      output.innerHTML = "";
      addLine("Local state erased. Virtual filesystem reset.", "line banner-line");
      updatePrompt();
      commandInput.focus();
    }, false);

    bindQuickCommands();
    bindEditor();
    commandInput.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, false);
  } else {
    init();
  }
}());
