# PocketBox Shell

PocketBox is a dependency-free, BusyBox-inspired **virtual shell** written in plain JavaScript. It is designed to run from local files or a simple static web server.

*Please note that this is still a work in progress, and some things might not work.

It does **not** execute native programs, open a real device shell, or access the host filesystem. All commands operate on a small in-memory virtual filesystem.

## Included modes

- `modern.html` — HTML5 rich-device mode for current phones, tablets, and desktops. It has a responsive terminal, touch-friendly command buttons, command history, theme switching, optional `localStorage` persistence, and a full-screen vi-like editor.
- `legacy.html` — HTML 4.01 / ES3-style mode for very old browsers and embedded devices. It uses a table layout, textarea output, classic event handlers, a simplified vi-like editor, and no HTML5 storage or modern JavaScript syntax.
- `index.html` — mode selector.
- `pocketbox-core.js` — shared shell and virtual filesystem.
- `pocketbox-security.js` — shared offline defensive-security toolkit.
- `pocketbox-network.js` — browser-constrained `curl` and `wget` command parser.
- `modern-ui.js` / `legacy-ui.js` — separate user interfaces.

## Start it

The files can be opened directly:

```text
index.html
modern.html
legacy.html
```

Some modern browsers restrict `localStorage` on `file://` pages. The shell still works, but persistence may be unavailable. A tiny local web server avoids that restriction:

```sh
python3 -m http.server 8080
```

Then open `http://127.0.0.1:8080/`.

No npm, build process, CDN, or framework is required. The shell itself has no remote dependencies; network access occurs only when the user explicitly runs `curl` or `wget`.

## Commands

```text
about append cat cd clear cp curl date df download echo env grep head help
history ls mkdir mv network pwd reset rm set tail touch tree uname
version vi vim wc wget whoami write

base64 entropy hash hashid headercheck hexdump hex ipcalc jwt md5
passgen rot13 security sha1 sha256 strings urldecode urlencode
```

Supported shell-like features:

```sh
echo hello world | wc -w
echo first > notes.txt
echo second >> notes.txt
grep -i pocket README.txt
mkdir -p projects/demo
write todo.txt Charge the device
append todo.txt Test legacy mode
```

This is deliberately limited. It does not support native executables, command substitution, background jobs, raw sockets, port scanning, remote exploitation, permissions, or arbitrary JavaScript evaluation. Its optional HTTP client remains inside the browser security model.


## Browser `curl` and `wget`

PocketBox includes text-oriented HTTP(S) clients implemented with browser `XMLHttpRequest` and a historical ActiveX XMLHTTP fallback in legacy mode. Requests originate from the browser. They do not run on, upload to, or modify the static web server that hosts PocketBox.

Run the built-in references:

```sh
network
help curl
help wget
```

Examples:

```sh
curl https://example.com/
curl -I https://example.com/
curl -i -H "Accept: application/json" https://example.com/api
curl -d @request.json -H "Content-Type: application/json" -o response.json https://example.com/api
wget https://example.com/page.html
wget -O saved.html https://example.com/
wget -O - README.md
```

`wget` saves into the **virtual filesystem**, not the host or server filesystem. Use `download FILE` afterward to export a saved virtual file through the browser.

Important browser restrictions:

- Same-origin and CORS rules apply. A remote site must allow the page origin to read its response.
- An HTTPS PocketBox page cannot request insecure HTTP content.
- JavaScript cannot disable certificate validation, forge protected headers such as `Host`, or bypass browser cookie controls.
- Relative URLs work only when PocketBox is served over HTTP(S). They are rejected on a `file://` page.
- Response headers are limited to those the browser exposes through CORS.
- Transfers are text-oriented. Binary downloads are not guaranteed to remain byte-for-byte identical in the virtual filesystem.
- Network commands cannot be used inside PocketBox pipelines or shell redirection. Use `curl -o FILE`, `curl -O`, or `wget -O FILE`.

Use these commands only against systems and endpoints you own or are authorized to test.

## Offline security toolkit

Run `security` for the complete built-in reference. These commands perform local transformation and defensive analysis only; they do not contact targets or open network connections. Use them only with data and systems you are authorized to assess.

```sh
security
echo admin | sha256
base64 "hello world"
base64 -d aGVsbG8gd29ybGQ=
hex -f notes.txt
hash sha256 -f notes.txt
hashid e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
entropy -f sample.txt
hexdump -f sample.txt
strings -n 6 -f sample.txt
ipcalc 192.168.10.25/24
jwt eyJhbGciOiJub25lIn0.eyJzdWIiOiJkZW1vIn0.
cat headers.txt | headercheck
passgen 24 3
```

Included capabilities:

- Base64, hexadecimal, URL-percent, and ROT13 encoding/decoding
- MD5, SHA-1, SHA-256, CRC32, and FNV-1a calculation
- Digest-length identification hints
- JWT header/payload decoding without signature verification
- IPv4 CIDR, mask, wildcard, network, broadcast, and usable-range calculation
- HTTP response security-header and cookie-flag review
- Shannon entropy estimation, printable-string extraction, and hexadecimal dumps
- Password-like string generation using Web Crypto when available

`passgen` prints a warning when an old browser lacks Web Crypto and must fall back to `Math.random`. Do not use that fallback for high-value secrets. `headercheck` reports items for review; a missing header is not automatically a vulnerability because application context matters.

## Vi-like editor and downloads

Open an existing or new virtual file with either command:

```sh
vi notes.txt
vim projects/demo.txt
```

The modern editor starts in **NORMAL** mode. Useful keys and commands are:

```text
i / a / I / A   enter insert mode
Esc             return to normal mode
h j k l         move the cursor
w / b           move by word
0 / $           line start / line end
gg / G          file start / file end
x               delete character
dd              delete line
u               undo the last editor change
:w              save into the virtual filesystem
:q              close when there are no unsaved changes
:wq             save and close
:q!             discard changes and close
:download       download the current editor buffer
```

Touch-friendly **Insert**, **Normal**, **Save**, **Download**, and **Close** controls are also provided. The legacy editor supports the core insert/normal workflow, `h`, `l`, `x`, `dd`, and the colon commands through classic form controls.

A saved virtual file can also be exported directly from the shell:

```sh
download notes.txt
```

Modern browsers receive a local Blob download link. HTML4 mode provides a `data:` download/open link and an **Open for Save As** fallback. Some very old Windows CE browsers do not implement downloadable Blob or `data:` URLs; in that case, open the text window and use the browser's Save As function.

## Legacy compatibility approach

The shared core and legacy UI intentionally avoid most modern browser dependencies:

- `let`, `const`, arrow functions, classes, modules, promises, and template literals
- `fetch`, WebSockets, workers, canvas, and service workers
- `localStorage` in legacy mode
- `querySelector`, `addEventListener`, and modern CSS layout in legacy mode
- external fonts, libraries, images, and network requests

Legacy network commands use native `XMLHttpRequest` when available and fall back to `Microsoft.XMLHTTP`/MSXML ActiveX objects. Very old devices may support same-origin HTTP only, may lack current TLS versions, or may have networking disabled. The legacy page targets old JScript/Pocket Internet Explorer-style environments, but Windows CE devices vary by OEM, CPU, browser build, memory, and security configuration. Test on the exact target device. The legacy UI falls back to `document.all` when `document.getElementById` is unavailable. The shared filesystem code also avoids requiring `Object.prototype.hasOwnProperty`, which fixes `ls` and related directory iteration on Pocket IE 4-era JScript engines. Devices must still support JavaScript arrays, regular expressions, and basic DOM form access.

## Persistence

Modern mode saves a plain snapshot of the virtual filesystem in browser `localStorage` when available. Legacy mode intentionally keeps data only for the current page session.

## Security boundary

PocketBox treats command input as data. It does not call `eval`, inject command output as HTML, load remote scripts, open raw sockets, or expose host-device APIs. Only explicit `curl` and `wget` commands can initiate browser HTTP(S) requests, and those requests remain subject to the browser security model. The offline security tools analyze only command text, piped text, and virtual files. The modern output uses text nodes; the legacy output uses a textarea.

## Testing

A small dependency-free test script is included:

```sh
node test_core.js
node test_ie4.js
```

`test_ie4.js` simulates an old JScript engine without `Object.prototype.hasOwnProperty` and verifies `ls`, `ls -l`, and `env`. Node is only a convenient test runner and is not required by the browser application.


## Windows CE / IE 5.5 compatibility update

The legacy page now avoids `Function.prototype.call`, `Array.prototype.sort`, and `Array.prototype.shift` during startup and basic shell use. Some Windows CE images identify the browser as IE 5.5 but bundle an older or reduced JScript engine. The legacy UI also falls back from `getElementById` to `document.all`, retries initialization after the DOM is parsed, and prints startup errors directly in the terminal area.

Use `legacy.html` on Windows CE. The richer `modern.html` remains unchanged. HTTPS, TLS, XHR/ActiveX, Blob downloads, and advanced commands still depend on the components installed in the particular Windows CE image.

*Still some bugs found on legacy mode about it crashing while using browser. Needs some more work in making it lighter + bug fix.
