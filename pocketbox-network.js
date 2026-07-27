/* PocketBox Browser Network Tools 1.0
 * ES3-style command parsing for browser-constrained curl and wget commands.
 * The UI performs requests with XMLHttpRequest/ActiveX; browser origin,
 * CORS, TLS, and mixed-content rules always apply.
 */
(function (global) {
  var PocketBox = global.PocketBox;
  var oldRunCommand;
  function invokeOld(owner, method, args) {
    var key = "__pocketbox_old_method";
    var previous = owner[key];
    var result;
    var caught = null;
    owner[key] = method;
    try {
      if (!args || args.length === 0) {
        result = owner[key]();
      } else if (args.length === 1) {
        result = owner[key](args[0]);
      } else if (args.length === 2) {
        result = owner[key](args[0], args[1]);
      } else {
        result = owner[key](args[0], args[1], args[2]);
      }
    } catch (error) {
      caught = error;
    }
    owner[key] = previous;
    if (caught) {
      throw caught;
    }
    return result;
  }

  var oldCommandHelp;
  var oldResetFileSystem;

  if (!PocketBox) {
    return;
  }

  function trimText(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function upper(value) {
    return String(value || "").toUpperCase();
  }

  function isHttpLikeUrl(value) {
    var text = String(value || "");
    var match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(text);
    if (!match) {
      return true;
    }
    return String(match[1]).toLowerCase() === "http" || String(match[1]).toLowerCase() === "https";
  }

  function validateUrl(value) {
    var text = trimText(value);
    if (!text) {
      throw new Error("a URL is required");
    }
    if (!isHttpLikeUrl(text)) {
      throw new Error("only HTTP and HTTPS URLs are supported");
    }
    if (/^https?:\/\/[^\/?#]*@/i.test(text)) {
      throw new Error("credentials in URLs are not supported; use an Authorization header when authorized");
    }
    if (/\r|\n/.test(text)) {
      throw new Error("invalid URL");
    }
    return text;
  }

  function validateHeader(value) {
    var text = String(value || "");
    var colon = text.indexOf(":");
    var name;
    var headerValue;
    if (/\r|\n/.test(text)) {
      throw new Error("header values cannot contain line breaks");
    }
    if (colon <= 0) {
      throw new Error("header must use NAME: VALUE");
    }
    name = trimText(text.substring(0, colon));
    headerValue = trimText(text.substring(colon + 1));
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      throw new Error("invalid header name: " + name);
    }
    return { name: name, value: headerValue };
  }

  function addHeader(request, value) {
    request.headers[request.headers.length] = validateHeader(value);
  }

  function parseSeconds(value, optionName) {
    var seconds = parseFloat(value);
    if (isNaN(seconds) || seconds <= 0 || seconds > 600) {
      throw new Error(optionName + " must be between 0 and 600 seconds");
    }
    return Math.round(seconds * 1000);
  }

  function prepareOutputPath(shell, path) {
    var normalized = shell.normalizePath(path);
    var parent = shell.parentPath(normalized);
    if (!shell.fs[parent] || shell.fs[parent].type !== "dir") {
      throw new Error("parent directory does not exist: " + parent);
    }
    if (shell.fs[normalized] && shell.fs[normalized].type === "dir") {
      throw new Error("is a directory: " + normalized);
    }
    return normalized;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (ignore) {
      return value;
    }
  }

  function remoteFileName(url) {
    var clean = String(url || "").replace(/[?#].*$/, "");
    var slash = clean.lastIndexOf("/");
    var name = slash === -1 ? clean : clean.substring(slash + 1);
    name = safeDecode(name);
    name = name.replace(/[\\\/:*?"<>|\x00-\x1F]/g, "_");
    if (!name || name === "." || name === "..") {
      name = "index.html";
    }
    if (name.length > 120) {
      name = name.substring(0, 120);
    }
    return name;
  }

  function dataValue(shell, value) {
    var text = String(value == null ? "" : value);
    if (text.charAt(0) === "@" && text.length > 1) {
      return shell.readFile(text.substring(1));
    }
    return text;
  }

  function nextValue(args, index, optionName) {
    if (index + 1 >= args.length) {
      throw new Error(optionName + " requires a value");
    }
    return args[index + 1];
  }

  function curlHelp() {
    return "PocketBox curl - browser HTTP client\n" +
      "Usage: curl [OPTIONS] URL\n\n" +
      "  -I, --head             request headers only\n" +
      "  -i, --include          include response headers\n" +
      "  -X, --request METHOD   choose HTTP method\n" +
      "  -H, --header HEADER    add request header\n" +
      "  -d, --data DATA        send request body; @FILE reads a virtual file\n" +
      "  -o, --output FILE      save body into the virtual filesystem\n" +
      "  -O, --remote-name      save using the remote filename\n" +
      "  -f, --fail             treat HTTP 400+ as an error\n" +
      "  -s, --silent           suppress transfer status text\n" +
      "  -L, --location         accepted; browsers handle redirects\n" +
      "      --max-time SEC     request timeout, maximum 600 seconds\n\n" +
      "Browser CORS, CSP, TLS, cookie, and mixed-content rules apply.";
  }

  function wgetHelp() {
    return "PocketBox wget - browser downloader\n" +
      "Usage: wget [OPTIONS] URL\n\n" +
      "  -O, --output-document FILE   save to FILE; use - for terminal output\n" +
      "  -q, --quiet                  suppress transfer status text\n" +
      "  -S, --server-response        display accessible response headers\n" +
      "      --header HEADER          add request header\n" +
      "      --method METHOD          choose HTTP method\n" +
      "      --body-data DATA         send request body; @FILE reads a virtual file\n" +
      "  -T, --timeout SEC            request timeout, maximum 600 seconds\n\n" +
      "Without -O, the response is saved under the URL's filename in the current virtual directory.";
  }

  function parseCurl(shell, args) {
    var request = {
      tool: "curl",
      method: "GET",
      url: "",
      headers: [],
      body: null,
      includeHeaders: false,
      outputPath: "",
      printBody: true,
      silent: false,
      failOnHttpError: false,
      timeoutMs: 30000
    };
    var i;
    var arg;
    var value;
    var remoteName = false;
    if (args.length === 0) {
      throw new Error("usage: curl [OPTIONS] URL");
    }
    for (i = 0; i < args.length; i += 1) {
      arg = args[i];
      if (arg === "--help" || arg === "-h") {
        return { text: curlHelp() };
      }
      if (arg === "-I" || arg === "--head") {
        request.method = "HEAD";
        request.includeHeaders = true;
        request.printBody = false;
      } else if (arg === "-i" || arg === "--include") {
        request.includeHeaders = true;
      } else if (arg === "-s" || arg === "--silent") {
        request.silent = true;
      } else if (arg === "-f" || arg === "--fail") {
        request.failOnHttpError = true;
      } else if (arg === "-L" || arg === "--location" || arg === "--compressed") {
        /* Browsers perform permitted redirects and content decoding themselves. */
      } else if (arg === "-k" || arg === "--insecure") {
        throw new Error("browsers do not allow JavaScript to disable TLS verification");
      } else if (arg === "-X" || arg === "--request") {
        value = nextValue(args, i, arg);
        i += 1;
        request.method = upper(value);
      } else if (arg.indexOf("--request=") === 0) {
        request.method = upper(arg.substring(10));
      } else if (arg === "-H" || arg === "--header") {
        value = nextValue(args, i, arg);
        i += 1;
        addHeader(request, value);
      } else if (arg.indexOf("--header=") === 0) {
        addHeader(request, arg.substring(9));
      } else if (arg === "-d" || arg === "--data" || arg === "--data-raw") {
        value = nextValue(args, i, arg);
        i += 1;
        request.body = dataValue(shell, value);
        if (request.method === "GET") {
          request.method = "POST";
        }
      } else if (arg.indexOf("--data=") === 0) {
        request.body = dataValue(shell, arg.substring(7));
        if (request.method === "GET") {
          request.method = "POST";
        }
      } else if (arg === "-o" || arg === "--output") {
        value = nextValue(args, i, arg);
        i += 1;
        if (value === "-") {
          request.outputPath = "";
          request.printBody = true;
        } else {
          request.outputPath = prepareOutputPath(shell, value);
          request.printBody = false;
        }
      } else if (arg.indexOf("--output=") === 0) {
        value = arg.substring(9);
        request.outputPath = prepareOutputPath(shell, value);
        request.printBody = false;
      } else if (arg === "-O" || arg === "--remote-name") {
        remoteName = true;
        request.printBody = false;
      } else if (arg === "--max-time") {
        value = nextValue(args, i, arg);
        i += 1;
        request.timeoutMs = parseSeconds(value, arg);
      } else if (arg.indexOf("--max-time=") === 0) {
        request.timeoutMs = parseSeconds(arg.substring(11), "--max-time");
      } else if (arg.charAt(0) === "-") {
        throw new Error("curl option not supported: " + arg);
      } else if (!request.url) {
        request.url = validateUrl(arg);
      } else {
        throw new Error("curl supports one URL per command");
      }
    }
    if (!request.url) {
      throw new Error("curl requires a URL");
    }
    if (!/^[A-Z]+$/.test(request.method)) {
      throw new Error("invalid HTTP method");
    }
    if (remoteName) {
      request.outputPath = prepareOutputPath(shell, remoteFileName(request.url));
    }
    return { text: "", action: "http", request: request };
  }

  function parseWget(shell, args) {
    var request = {
      tool: "wget",
      method: "GET",
      url: "",
      headers: [],
      body: null,
      includeHeaders: false,
      outputPath: "",
      printBody: false,
      silent: false,
      failOnHttpError: true,
      timeoutMs: 30000
    };
    var i;
    var arg;
    var value;
    var outputSpecified = false;
    if (args.length === 0) {
      throw new Error("usage: wget [OPTIONS] URL");
    }
    for (i = 0; i < args.length; i += 1) {
      arg = args[i];
      if (arg === "--help" || arg === "-h") {
        return { text: wgetHelp() };
      }
      if (arg === "-q" || arg === "--quiet") {
        request.silent = true;
      } else if (arg === "-S" || arg === "--server-response") {
        request.includeHeaders = true;
      } else if (arg === "--no-check-certificate") {
        throw new Error("browsers do not allow JavaScript to disable TLS verification");
      } else if (arg === "-O" || arg === "--output-document") {
        value = nextValue(args, i, arg);
        i += 1;
        outputSpecified = true;
        if (value === "-") {
          request.outputPath = "";
          request.printBody = true;
        } else {
          request.outputPath = prepareOutputPath(shell, value);
        }
      } else if (arg.indexOf("--output-document=") === 0) {
        value = arg.substring(18);
        outputSpecified = true;
        if (value === "-") {
          request.printBody = true;
        } else {
          request.outputPath = prepareOutputPath(shell, value);
        }
      } else if (arg === "--header") {
        value = nextValue(args, i, arg);
        i += 1;
        addHeader(request, value);
      } else if (arg.indexOf("--header=") === 0) {
        addHeader(request, arg.substring(9));
      } else if (arg === "--method") {
        value = nextValue(args, i, arg);
        i += 1;
        request.method = upper(value);
      } else if (arg.indexOf("--method=") === 0) {
        request.method = upper(arg.substring(9));
      } else if (arg === "--body-data" || arg === "--post-data") {
        value = nextValue(args, i, arg);
        i += 1;
        request.body = dataValue(shell, value);
        if (request.method === "GET") {
          request.method = "POST";
        }
      } else if (arg.indexOf("--body-data=") === 0) {
        request.body = dataValue(shell, arg.substring(12));
        if (request.method === "GET") {
          request.method = "POST";
        }
      } else if (arg === "-T" || arg === "--timeout") {
        value = nextValue(args, i, arg);
        i += 1;
        request.timeoutMs = parseSeconds(value, arg);
      } else if (arg.indexOf("--timeout=") === 0) {
        request.timeoutMs = parseSeconds(arg.substring(10), "--timeout");
      } else if (arg.charAt(0) === "-") {
        throw new Error("wget option not supported: " + arg);
      } else if (!request.url) {
        request.url = validateUrl(arg);
      } else {
        throw new Error("wget supports one URL per command");
      }
    }
    if (!request.url) {
      throw new Error("wget requires a URL");
    }
    if (!/^[A-Z]+$/.test(request.method)) {
      throw new Error("invalid HTTP method");
    }
    if (!outputSpecified) {
      request.outputPath = prepareOutputPath(shell, remoteFileName(request.url));
    }
    return { text: "", action: "http", request: request };
  }

  function networkOverview() {
    return "PocketBox Browser Network Tools\n" +
      "These commands issue HTTP(S) requests from the browser, not from the host OS or web server.\n\n" +
      "  curl [OPTIONS] URL     print or save an HTTP response\n" +
      "  wget [OPTIONS] URL     save a response into the virtual filesystem\n\n" +
      "Examples:\n" +
      "  curl https://example.com/\n" +
      "  curl -I https://example.com/\n" +
      "  curl -H \"Accept: application/json\" -o result.json https://example.com/api\n" +
      "  wget -O page.html https://example.com/\n" +
      "  wget README.md\n\n" +
      "Restrictions: CORS and same-origin policy apply; HTTPS pages cannot fetch plain HTTP; browser TLS checks cannot be disabled; forbidden headers and protected cookies remain controlled by the browser. Relative URLs require serving PocketBox over HTTP(S), not file://. Use only systems you are authorized to access.";
  }

  oldCommandHelp = PocketBox.prototype.commandHelp;
  PocketBox.prototype.commandHelp = function (args) {
    var name = args && args.length ? String(args[0]).toLowerCase() : "";
    var base;
    if (name === "curl") {
      return curlHelp();
    }
    if (name === "wget") {
      return wgetHelp();
    }
    if (name === "network" || name === "nettools") {
      return networkOverview();
    }
    base = invokeOld(this, oldCommandHelp, [args]);
    if (!args || args.length === 0) {
      base += "\n\nBrowser network tools:\n  curl wget network\nRun 'network' for browser restrictions and examples.";
    }
    return base;
  };

  oldResetFileSystem = PocketBox.prototype.resetFileSystem;
  PocketBox.prototype.resetFileSystem = function () {
    invokeOld(this, oldResetFileSystem, []);
    this.writeFile("/docs/NETWORK.txt", networkOverview() + "\n", false);
  };

  oldRunCommand = PocketBox.prototype.runCommand;
  PocketBox.prototype.runCommand = function (command, args, stdinText) {
    if (command === "network" || command === "nettools") {
      return networkOverview();
    }
    if (command === "curl") {
      if (stdinText) {
        throw new Error("curl cannot consume piped input; use -d @FILE for request data");
      }
      return parseCurl(this, args);
    }
    if (command === "wget") {
      if (stdinText) {
        throw new Error("wget cannot consume piped input");
      }
      return parseWget(this, args);
    }
    return invokeOld(this, oldRunCommand, [command, args, stdinText]);
  };
}(this));
