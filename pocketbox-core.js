/* PocketBox Shell Core 1.0
 * Dependency-free, ES3-style JavaScript for modern and legacy browsers.
 * This is a sandboxed virtual shell. It does not access the host OS.
 */
(function (global) {
  function trimText(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function startsWithText(value, prefix) {
    return String(value).substr(0, String(prefix).length) === String(prefix);
  }

  function repeatText(value, count) {
    var out = "";
    var i;
    for (i = 0; i < count; i += 1) {
      out += value;
    }
    return out;
  }

  function padLeft(value, width) {
    var text = String(value);
    while (text.length < width) {
      text = " " + text;
    }
    return text;
  }


  function sortStrings(values) {
    var i;
    var j;
    var value;
    /* Insertion sort avoids relying on Array.prototype.sort in reduced CE engines. */
    for (i = 1; i < values.length; i += 1) {
      value = values[i];
      j = i - 1;
      while (j >= 0 && String(values[j]) > String(value)) {
        values[j + 1] = values[j];
        j -= 1;
      }
      values[j + 1] = value;
    }
    return values;
  }

  function owns(source, key) {
    if (!source) {
      return false;
    }
    if (source.hasOwnProperty) {
      try {
        return source.hasOwnProperty(key);
      } catch (ignoreOwnProperty) {
        /* Fall through for older JScript engines. */
      }
    }
    return typeof source[key] !== "undefined";
  }

  function copyObject(source) {
    var target = {};
    var key;
    for (key in source) {
      if (owns(source, key)) {
        target[key] = source[key];
      }
    }
    return target;
  }

  function isSafeSegment(segment) {
    var lower = String(segment).toLowerCase();
    return lower !== "__proto__" && lower !== "prototype" && lower !== "constructor";
  }

  function tokenize(line) {
    var tokens = [];
    var token = "";
    var quote = "";
    var escaped = false;
    var i;
    var ch;

    for (i = 0; i < line.length; i += 1) {
      ch = line.charAt(i);
      if (escaped) {
        token += ch;
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (quote) {
        if (ch === quote) {
          quote = "";
        } else {
          token += ch;
        }
      } else if (ch === "\"" || ch === "'") {
        quote = ch;
      } else if (ch === " " || ch === "\t") {
        if (token !== "") {
          tokens[tokens.length] = token;
          token = "";
        }
      } else if (ch === ">") {
        if (token !== "") {
          tokens[tokens.length] = token;
          token = "";
        }
        if (line.charAt(i + 1) === ">") {
          tokens[tokens.length] = ">>";
          i += 1;
        } else {
          tokens[tokens.length] = ">";
        }
      } else {
        token += ch;
      }
    }

    if (escaped) {
      token += "\\";
    }
    if (quote) {
      return { error: "unterminated quote", tokens: [] };
    }
    if (token !== "") {
      tokens[tokens.length] = token;
    }
    return { error: "", tokens: tokens };
  }

  function splitPipeline(line) {
    var parts = [];
    var part = "";
    var quote = "";
    var escaped = false;
    var i;
    var ch;

    for (i = 0; i < line.length; i += 1) {
      ch = line.charAt(i);
      if (escaped) {
        part += ch;
        escaped = false;
      } else if (ch === "\\") {
        part += ch;
        escaped = true;
      } else if (quote) {
        part += ch;
        if (ch === quote) {
          quote = "";
        }
      } else if (ch === "\"" || ch === "'") {
        quote = ch;
        part += ch;
      } else if (ch === "|") {
        parts[parts.length] = trimText(part);
        part = "";
      } else {
        part += ch;
      }
    }
    parts[parts.length] = trimText(part);
    return parts;
  }

  function PocketBox(options) {
    options = options || {};
    this.version = "1.3.2-ce";
    this.name = options.name || "PocketBox";
    this.user = options.user || "guest";
    this.host = options.host || "device";
    this.home = "/home/" + this.user;
    this.cwd = this.home;
    this.maxHistory = options.maxHistory || 60;
    this.commandHistory = [];
    this.fs = {};
    this.env = {
      HOME: this.home,
      USER: this.user,
      HOSTNAME: this.host,
      SHELL: "/bin/pocketbox",
      PATH: "/bin",
      TERM: options.term || "virtual"
    };
    this.resetFileSystem();
  }

  PocketBox.prototype.now = function () {
    return new Date().getTime();
  };

  PocketBox.prototype.normalizePath = function (path) {
    var raw = trimText(path || "");
    var joined;
    var chunks;
    var stack = [];
    var i;
    var segment;

    if (raw === "") {
      raw = this.cwd;
    }
    if (raw === "~") {
      raw = this.home;
    } else if (startsWithText(raw, "~/")) {
      raw = this.home + raw.substr(1);
    }
    joined = raw.charAt(0) === "/" ? raw : this.cwd + "/" + raw;
    chunks = joined.split("/");
    for (i = 0; i < chunks.length; i += 1) {
      segment = chunks[i];
      if (segment === "" || segment === ".") {
        continue;
      }
      if (segment === "..") {
        if (stack.length > 0) {
          stack.length -= 1;
        }
      } else {
        if (!isSafeSegment(segment)) {
          throw new Error("unsafe path segment: " + segment);
        }
        stack[stack.length] = segment;
      }
    }
    return "/" + stack.join("/");
  };

  PocketBox.prototype.parentPath = function (path) {
    var normalized = this.normalizePath(path);
    var index;
    if (normalized === "/") {
      return "/";
    }
    index = normalized.lastIndexOf("/");
    return index <= 0 ? "/" : normalized.substring(0, index);
  };

  PocketBox.prototype.baseName = function (path) {
    var normalized = this.normalizePath(path);
    var index;
    if (normalized === "/") {
      return "/";
    }
    index = normalized.lastIndexOf("/");
    return normalized.substring(index + 1);
  };

  PocketBox.prototype.exists = function (path) {
    var normalized = this.normalizePath(path);
    return typeof this.fs[normalized] !== "undefined";
  };

  PocketBox.prototype.getNode = function (path) {
    return this.fs[this.normalizePath(path)];
  };

  PocketBox.prototype.addDir = function (path) {
    var normalized = this.normalizePath(path);
    var parent = this.parentPath(normalized);
    if (normalized !== "/" && (!this.fs[parent] || this.fs[parent].type !== "dir")) {
      throw new Error("parent directory does not exist: " + parent);
    }
    if (this.fs[normalized] && this.fs[normalized].type !== "dir") {
      throw new Error("path is a file: " + normalized);
    }
    this.fs[normalized] = { type: "dir", content: "", mtime: this.now() };
  };

  PocketBox.prototype.makeDirRecursive = function (path) {
    var normalized = this.normalizePath(path);
    var parts = normalized.split("/");
    var current = "";
    var i;
    for (i = 1; i < parts.length; i += 1) {
      if (!parts[i]) {
        continue;
      }
      current += "/" + parts[i];
      if (!this.fs[current]) {
        this.fs[current] = { type: "dir", content: "", mtime: this.now() };
      } else if (this.fs[current].type !== "dir") {
        throw new Error("path is a file: " + current);
      }
    }
  };

  PocketBox.prototype.writeFile = function (path, content, append) {
    var normalized = this.normalizePath(path);
    var parent = this.parentPath(normalized);
    var old;
    if (!this.fs[parent] || this.fs[parent].type !== "dir") {
      throw new Error("parent directory does not exist: " + parent);
    }
    if (this.fs[normalized] && this.fs[normalized].type === "dir") {
      throw new Error("is a directory: " + normalized);
    }
    old = this.fs[normalized] ? this.fs[normalized].content : "";
    this.fs[normalized] = {
      type: "file",
      content: append ? old + String(content) : String(content),
      mtime: this.now()
    };
  };

  PocketBox.prototype.readFile = function (path) {
    var normalized = this.normalizePath(path);
    var node = this.fs[normalized];
    if (!node) {
      throw new Error("no such file: " + normalized);
    }
    if (node.type !== "file") {
      throw new Error("is a directory: " + normalized);
    }
    return node.content;
  };

  PocketBox.prototype.listChildren = function (path) {
    var normalized = this.normalizePath(path);
    var node = this.fs[normalized];
    var prefix;
    var result = [];
    var key;
    var rest;
    if (!node) {
      throw new Error("no such path: " + normalized);
    }
    if (node.type === "file") {
      return [normalized];
    }
    prefix = normalized === "/" ? "/" : normalized + "/";
    for (key in this.fs) {
      if (owns(this.fs, key) && key !== normalized && startsWithText(key, prefix)) {
        rest = key.substr(prefix.length);
        if (rest !== "" && rest.indexOf("/") === -1) {
          result[result.length] = key;
        }
      }
    }
    sortStrings(result);
    return result;
  };

  PocketBox.prototype.removePath = function (path, recursive) {
    var normalized = this.normalizePath(path);
    var node = this.fs[normalized];
    var prefix;
    var key;
    if (!node) {
      throw new Error("no such path: " + normalized);
    }
    if (normalized === "/") {
      throw new Error("cannot remove root");
    }
    if (node.type === "dir") {
      if (this.listChildren(normalized).length > 0 && !recursive) {
        throw new Error("directory not empty: " + normalized);
      }
      prefix = normalized + "/";
      for (key in this.fs) {
        if (owns(this.fs, key) && startsWithText(key, prefix)) {
          delete this.fs[key];
        }
      }
    }
    delete this.fs[normalized];
    if (startsWithText(this.cwd + "/", normalized + "/")) {
      this.cwd = this.home;
    }
  };

  PocketBox.prototype.copyPath = function (source, destination) {
    var src = this.normalizePath(source);
    var dst = this.normalizePath(destination);
    var srcNode = this.fs[src];
    var dstNode = this.fs[dst];
    if (!srcNode) {
      throw new Error("no such source: " + src);
    }
    if (srcNode.type !== "file") {
      throw new Error("cp supports files only");
    }
    if (dstNode && dstNode.type === "dir") {
      dst = dst === "/" ? "/" + this.baseName(src) : dst + "/" + this.baseName(src);
    }
    this.writeFile(dst, srcNode.content, false);
  };

  PocketBox.prototype.movePath = function (source, destination) {
    var src = this.normalizePath(source);
    var dst = this.normalizePath(destination);
    var srcNode = this.fs[src];
    var dstNode = this.fs[dst];
    if (!srcNode) {
      throw new Error("no such source: " + src);
    }
    if (dstNode && dstNode.type === "dir") {
      dst = dst === "/" ? "/" + this.baseName(src) : dst + "/" + this.baseName(src);
    }
    if (srcNode.type === "file") {
      this.writeFile(dst, srcNode.content, false);
      this.removePath(src, false);
      return;
    }
    throw new Error("mv supports files only");
  };

  PocketBox.prototype.resetFileSystem = function () {
    this.fs = {};
    this.fs["/"] = { type: "dir", content: "", mtime: this.now() };
    this.makeDirRecursive("/home/" + this.user);
    this.makeDirRecursive("/etc");
    this.makeDirRecursive("/tmp");
    this.makeDirRecursive("/docs");
    this.writeFile("/etc/motd", "PocketBox virtual shell\nType 'help' for commands.\n", false);
    this.writeFile(this.home + "/README.txt",
      "Welcome to PocketBox.\n\n" +
      "This shell runs entirely inside JavaScript. It cannot access the real device filesystem or execute native programs.\n\n" +
      "Try:\n" +
      "  ls -l\n" +
      "  cat README.txt\n" +
      "  echo hello | wc -w\n" +
      "  write notes.txt Remember the batteries\n" +
      "  grep -i pocket README.txt\n", false);
    this.writeFile("/docs/COMMANDS.txt", "Run 'help' to list commands.\n", false);
    this.cwd = this.home;
  };

  PocketBox.prototype.formatDate = function (milliseconds) {
    var date = new Date(milliseconds);
    var year = date.getFullYear();
    var month = padLeft(date.getMonth() + 1, 2);
    var day = padLeft(date.getDate(), 2);
    var hour = padLeft(date.getHours(), 2);
    var minute = padLeft(date.getMinutes(), 2);
    var second = padLeft(date.getSeconds(), 2);
    return year + "-" + month + "-" + day + " " + hour + ":" + minute + ":" + second;
  };

  PocketBox.prototype.prompt = function () {
    var shown = this.cwd;
    if (shown === this.home) {
      shown = "~";
    } else if (startsWithText(shown, this.home + "/")) {
      shown = "~" + shown.substr(this.home.length);
    }
    return this.user + "@" + this.host + ":" + shown + "$ ";
  };

  PocketBox.prototype.expandVariables = function (tokens) {
    var out = [];
    var i;
    var token;
    var name;
    for (i = 0; i < tokens.length; i += 1) {
      token = tokens[i];
      if (token.charAt(0) === "$" && token.length > 1) {
        name = token.substr(1);
        out[out.length] = typeof this.env[name] !== "undefined" ? this.env[name] : "";
      } else {
        out[out.length] = token;
      }
    }
    return out;
  };

  PocketBox.prototype.getInputText = function (args, stdinText) {
    if (args.length > 0) {
      return this.readFile(args[0]);
    }
    return String(stdinText || "");
  };

  PocketBox.prototype.commandHelp = function (args) {
    var detailed = {
      cat: "cat [FILE ...] - print files, or piped input when no file is given",
      cd: "cd [DIR] - change virtual directory",
      cp: "cp SOURCE DEST - copy one virtual file",
      echo: "echo [TEXT ...] - print text",
      grep: "grep [-i] PATTERN [FILE ...] - print matching lines",
      head: "head [-n NUMBER] [FILE] - print first lines",
      ls: "ls [-l] [PATH] - list virtual files",
      mkdir: "mkdir [-p] DIR ... - create directories",
      mv: "mv SOURCE DEST - move one virtual file",
      rm: "rm [-r] PATH ... - remove virtual files or directories",
      tail: "tail [-n NUMBER] [FILE] - print last lines",
      wc: "wc [-l|-w|-c] [FILE] - count lines, words, or characters",
      write: "write FILE TEXT ... - replace a virtual file",
      append: "append FILE TEXT ... - append text to a virtual file",
      set: "set NAME VALUE - set a shell variable",
      tree: "tree [PATH] - show a virtual directory tree",
      vi: "vi FILE - open FILE in the built-in vi-like editor",
      vim: "vim FILE - alias for vi",
      download: "download FILE - create a browser download link for a virtual file"
    };
    if (args.length > 0) {
      return detailed[args[0]] || "No detailed help for: " + args[0];
    }
    return "PocketBox commands:\n" +
      "  about append cat cd clear cp date df download echo env grep head help\n" +
      "  history ls mkdir mv pwd reset rm set tail touch tree uname\n" +
      "  version vi vim wc whoami write\n\n" +
      "Features: quoted arguments, pipelines (|), overwrite (>), append (>>).\n" +
      "Use 'help COMMAND' for selected command details.";
  };

  PocketBox.prototype.commandLs = function (args) {
    var longMode = false;
    var path = this.cwd;
    var i;
    var items;
    var lines = [];
    var node;
    var name;
    for (i = 0; i < args.length; i += 1) {
      if (args[i] === "-l") {
        longMode = true;
      } else {
        path = args[i];
      }
    }
    items = this.listChildren(path);
    for (i = 0; i < items.length; i += 1) {
      node = this.fs[items[i]];
      name = this.baseName(items[i]) + (node.type === "dir" ? "/" : "");
      if (longMode) {
        lines[lines.length] = (node.type === "dir" ? "d" : "-") + "rw------- " +
          padLeft(node.type === "file" ? node.content.length : 0, 7) + " " +
          this.formatDate(node.mtime) + " " + name;
      } else {
        lines[lines.length] = name;
      }
    }
    return lines.join(longMode ? "\n" : "  ");
  };

  PocketBox.prototype.commandCat = function (args, stdinText) {
    var out = [];
    var i;
    if (args.length === 0) {
      return String(stdinText || "");
    }
    for (i = 0; i < args.length; i += 1) {
      out[out.length] = this.readFile(args[i]);
    }
    return out.join("");
  };

  PocketBox.prototype.commandHeadTail = function (args, stdinText, fromTail) {
    var count = 10;
    var fileArgs = [];
    var lines;
    var start;
    var i;
    for (i = 0; i < args.length; i += 1) {
      if (args[i] === "-n" && i + 1 < args.length) {
        count = parseInt(args[i + 1], 10);
        i += 1;
      } else {
        fileArgs[fileArgs.length] = args[i];
      }
    }
    if (isNaN(count) || count < 0) {
      throw new Error("invalid line count");
    }
    lines = this.getInputText(fileArgs, stdinText).replace(/\r/g, "").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.length -= 1;
    }
    if (fromTail) {
      start = lines.length - count;
      if (start < 0) {
        start = 0;
      }
      return lines.slice(start).join("\n");
    }
    return lines.slice(0, count).join("\n");
  };

  PocketBox.prototype.commandWc = function (args, stdinText) {
    var mode = "all";
    var fileArgs = [];
    var text;
    var clean;
    var lines;
    var words;
    var chars;
    var i;
    for (i = 0; i < args.length; i += 1) {
      if (args[i] === "-l" || args[i] === "-w" || args[i] === "-c") {
        mode = args[i];
      } else {
        fileArgs[fileArgs.length] = args[i];
      }
    }
    text = this.getInputText(fileArgs, stdinText);
    clean = trimText(text);
    lines = text === "" ? 0 : text.replace(/\r/g, "").split("\n").length;
    if (text.charAt(text.length - 1) === "\n") {
      lines -= 1;
    }
    words = clean === "" ? 0 : clean.split(/\s+/).length;
    chars = text.length;
    if (mode === "-l") {
      return String(lines);
    }
    if (mode === "-w") {
      return String(words);
    }
    if (mode === "-c") {
      return String(chars);
    }
    return lines + " " + words + " " + chars;
  };

  PocketBox.prototype.commandGrep = function (args, stdinText) {
    var ignoreCase = false;
    var index = 0;
    var pattern;
    var files = [];
    var input;
    var lines;
    var out = [];
    var targetPattern;
    var targetLine;
    var i;
    if (args[0] === "-i") {
      ignoreCase = true;
      index = 1;
    }
    if (index >= args.length) {
      throw new Error("grep requires a pattern");
    }
    pattern = args[index];
    index += 1;
    while (index < args.length) {
      files[files.length] = args[index];
      index += 1;
    }
    input = files.length > 0 ? this.commandCat(files, "") : String(stdinText || "");
    lines = input.replace(/\r/g, "").split("\n");
    targetPattern = ignoreCase ? pattern.toLowerCase() : pattern;
    for (i = 0; i < lines.length; i += 1) {
      targetLine = ignoreCase ? lines[i].toLowerCase() : lines[i];
      if (targetLine.indexOf(targetPattern) !== -1) {
        out[out.length] = lines[i];
      }
    }
    return out.join("\n");
  };

  PocketBox.prototype.commandTree = function (args) {
    var root = this.normalizePath(args[0] || this.cwd);
    var out = [root];
    var self = this;
    function walk(path, prefix) {
      var children = self.listChildren(path);
      var i;
      var child;
      var last;
      for (i = 0; i < children.length; i += 1) {
        child = children[i];
        last = i === children.length - 1;
        out[out.length] = prefix + (last ? "`-- " : "|-- ") + self.baseName(child) + (self.fs[child].type === "dir" ? "/" : "");
        if (self.fs[child].type === "dir") {
          walk(child, prefix + (last ? "    " : "|   "));
        }
      }
    }
    if (!this.fs[root]) {
      throw new Error("no such path: " + root);
    }
    if (this.fs[root].type === "dir") {
      walk(root, "");
    }
    return out.join("\n");
  };

  PocketBox.prototype.runCommand = function (command, args, stdinText) {
    var i;
    var target;
    var value;
    var lines;
    var key;
    var names;
    var totalBytes = 0;
    if (command === "help") {
      return this.commandHelp(args);
    }
    if (command === "about") {
      return "PocketBox is a tiny BusyBox-inspired shell implemented in browser JavaScript.\nIt is a virtual sandbox, not a native operating-system shell.";
    }
    if (command === "version") {
      return this.name + " " + this.version;
    }
    if (command === "echo") {
      return args.join(" ");
    }
    if (command === "pwd") {
      return this.cwd;
    }
    if (command === "whoami") {
      return this.user;
    }
    if (command === "uname") {
      return args[0] === "-a" ? "PocketBox " + this.version + " JavaScript virtual-device generic" : "PocketBox";
    }
    if (command === "date") {
      return this.formatDate(this.now());
    }
    if (command === "clear") {
      return { text: "", clear: true };
    }
    if (command === "vi" || command === "vim") {
      if (args.length !== 1) {
        throw new Error("usage: " + command + " FILE");
      }
      target = this.normalizePath(args[0]);
      if (!this.fs[this.parentPath(target)] || this.fs[this.parentPath(target)].type !== "dir") {
        throw new Error("parent directory does not exist: " + this.parentPath(target));
      }
      if (this.fs[target] && this.fs[target].type === "dir") {
        throw new Error("is a directory: " + target);
      }
      return {
        text: "",
        action: "edit",
        path: target,
        content: this.fs[target] ? this.fs[target].content : ""
      };
    }
    if (command === "download") {
      if (args.length !== 1) {
        throw new Error("usage: download FILE");
      }
      target = this.normalizePath(args[0]);
      return {
        text: "",
        action: "download",
        path: target,
        content: this.readFile(target)
      };
    }
    if (command === "ls") {
      return this.commandLs(args);
    }
    if (command === "cd") {
      target = this.normalizePath(args[0] || this.home);
      if (!this.fs[target]) {
        throw new Error("no such directory: " + target);
      }
      if (this.fs[target].type !== "dir") {
        throw new Error("not a directory: " + target);
      }
      this.cwd = target;
      return "";
    }
    if (command === "cat") {
      return this.commandCat(args, stdinText);
    }
    if (command === "head") {
      return this.commandHeadTail(args, stdinText, false);
    }
    if (command === "tail") {
      return this.commandHeadTail(args, stdinText, true);
    }
    if (command === "wc") {
      return this.commandWc(args, stdinText);
    }
    if (command === "grep") {
      return this.commandGrep(args, stdinText);
    }
    if (command === "mkdir") {
      for (i = args[0] === "-p" ? 1 : 0; i < args.length; i += 1) {
        if (args[0] === "-p") {
          this.makeDirRecursive(args[i]);
        } else {
          this.addDir(args[i]);
        }
      }
      if (args.length === 0 || (args.length === 1 && args[0] === "-p")) {
        throw new Error("mkdir requires a path");
      }
      return "";
    }
    if (command === "touch") {
      if (args.length === 0) {
        throw new Error("touch requires a file");
      }
      for (i = 0; i < args.length; i += 1) {
        target = this.normalizePath(args[i]);
        if (this.fs[target] && this.fs[target].type === "dir") {
          throw new Error("is a directory: " + target);
        }
        value = this.fs[target] ? this.fs[target].content : "";
        this.writeFile(target, value, false);
      }
      return "";
    }
    if (command === "write" || command === "append") {
      if (args.length < 1) {
        throw new Error(command + " requires a file");
      }
      target = args[0];
      value = args.slice(1).join(" ");
      this.writeFile(target, value + "\n", command === "append");
      return "";
    }
    if (command === "rm") {
      if (args.length === 0) {
        throw new Error("rm requires a path");
      }
      for (i = args[0] === "-r" ? 1 : 0; i < args.length; i += 1) {
        this.removePath(args[i], args[0] === "-r");
      }
      return "";
    }
    if (command === "cp") {
      if (args.length !== 2) {
        throw new Error("usage: cp SOURCE DEST");
      }
      this.copyPath(args[0], args[1]);
      return "";
    }
    if (command === "mv") {
      if (args.length !== 2) {
        throw new Error("usage: mv SOURCE DEST");
      }
      this.movePath(args[0], args[1]);
      return "";
    }
    if (command === "env") {
      names = [];
      for (key in this.env) {
        if (owns(this.env, key)) {
          names[names.length] = key;
        }
      }
      sortStrings(names);
      lines = [];
      for (i = 0; i < names.length; i += 1) {
        lines[lines.length] = names[i] + "=" + this.env[names[i]];
      }
      return lines.join("\n");
    }
    if (command === "set") {
      if (args.length < 2) {
        throw new Error("usage: set NAME VALUE");
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args[0]) || !isSafeSegment(args[0])) {
        throw new Error("invalid variable name");
      }
      this.env[args[0]] = args.slice(1).join(" ");
      return "";
    }
    if (command === "history") {
      lines = [];
      for (i = 0; i < this.commandHistory.length; i += 1) {
        lines[lines.length] = padLeft(i + 1, 4) + "  " + this.commandHistory[i];
      }
      return lines.join("\n");
    }
    if (command === "tree") {
      return this.commandTree(args);
    }
    if (command === "df") {
      for (key in this.fs) {
        if (owns(this.fs, key) && this.fs[key].type === "file") {
          totalBytes += this.fs[key].content.length;
        }
      }
      return "Filesystem        Bytes  Mounted on\nvirtual-memory " + padLeft(totalBytes, 10) + "  /";
    }
    if (command === "reset") {
      this.resetFileSystem();
      return "virtual filesystem reset";
    }
    throw new Error(command + ": command not found");
  };

  PocketBox.prototype.execute = function (line) {
    var original = trimText(line);
    var stages;
    var stdinText = "";
    var clear = false;
    var exitCode = 0;
    var stageIndex;
    var parsed;
    var tokens;
    var command;
    var args;
    var result;
    var redirection = "";
    var redirectionPath = "";
    var redirectIndex;
    var action = "";
    var actionPath = "";
    var actionContent = "";
    var actionRequest = null;

    if (original === "") {
      return { output: "", clear: false, exitCode: 0 };
    }
    this.commandHistory[this.commandHistory.length] = original;
    if (this.commandHistory.length > this.maxHistory) {
      for (stageIndex = 1; stageIndex < this.commandHistory.length; stageIndex += 1) {
        this.commandHistory[stageIndex - 1] = this.commandHistory[stageIndex];
      }
      this.commandHistory.length -= 1;
    }

    stages = splitPipeline(original);
    try {
      for (stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
        if (stages[stageIndex] === "") {
          throw new Error("empty command in pipeline");
        }
        parsed = tokenize(stages[stageIndex]);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        tokens = this.expandVariables(parsed.tokens);
        if (tokens.length === 0) {
          continue;
        }
        redirection = "";
        redirectionPath = "";
        for (redirectIndex = 0; redirectIndex < tokens.length; redirectIndex += 1) {
          if (tokens[redirectIndex] === ">" || tokens[redirectIndex] === ">>") {
            if (stageIndex !== stages.length - 1) {
              throw new Error("redirection is only supported on the final pipeline stage");
            }
            if (redirectIndex + 1 >= tokens.length) {
              throw new Error("redirection requires a file");
            }
            redirection = tokens[redirectIndex];
            redirectionPath = tokens[redirectIndex + 1];
            tokens.length = redirectIndex;
            break;
          }
        }
        command = String(tokens[0]).toLowerCase();
        args = tokens.slice(1);
        result = this.runCommand(command, args, stdinText);
        if (typeof result === "object") {
          if (result.action) {
            if (stages.length !== 1 || redirection) {
              throw new Error(result.action + " cannot be used in a pipeline or with redirection");
            }
            action = result.action;
            actionPath = result.path || "";
            actionContent = result.content || "";
            actionRequest = result.request || null;
          }
          stdinText = result.text || "";
          clear = clear || result.clear === true;
        } else {
          stdinText = String(result == null ? "" : result);
        }
        if (redirection) {
          this.writeFile(redirectionPath, stdinText + (stdinText && stdinText.charAt(stdinText.length - 1) !== "\n" ? "\n" : ""), redirection === ">>");
          stdinText = "";
        }
      }
    } catch (error) {
      exitCode = 1;
      stdinText = "error: " + (error && error.message ? error.message : String(error));
    }
    return { output: stdinText, clear: clear, exitCode: exitCode, action: action, path: actionPath, content: actionContent, request: actionRequest };
  };

  PocketBox.prototype.snapshot = function () {
    var fsCopy = {};
    var key;
    for (key in this.fs) {
      if (owns(this.fs, key)) {
        fsCopy[key] = {
          type: this.fs[key].type,
          content: this.fs[key].content,
          mtime: this.fs[key].mtime
        };
      }
    }
    return {
      version: this.version,
      cwd: this.cwd,
      fs: fsCopy,
      env: copyObject(this.env),
      history: this.commandHistory.slice(0)
    };
  };

  PocketBox.prototype.restoreSnapshot = function (snapshot) {
    var key;
    if (!snapshot || !snapshot.fs || !snapshot.cwd) {
      throw new Error("invalid snapshot");
    }
    if (!snapshot.fs["/"] || snapshot.fs["/"].type !== "dir") {
      throw new Error("snapshot has no root directory");
    }
    this.fs = {};
    for (key in snapshot.fs) {
      if (owns(snapshot.fs, key)) {
        this.normalizePath(key);
        this.fs[key] = {
          type: snapshot.fs[key].type === "dir" ? "dir" : "file",
          content: String(snapshot.fs[key].content || ""),
          mtime: Number(snapshot.fs[key].mtime || this.now())
        };
      }
    }
    this.cwd = this.normalizePath(snapshot.cwd);
    if (!this.fs[this.cwd] || this.fs[this.cwd].type !== "dir") {
      this.cwd = this.home;
    }
    if (snapshot.env) {
      this.env = copyObject(snapshot.env);
    }
    this.commandHistory = snapshot.history && snapshot.history.slice ? snapshot.history.slice(0, this.maxHistory) : [];
  };

  global.PocketBox = PocketBox;
}(this));
