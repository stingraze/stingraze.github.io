/* PocketBox Offline Security Toolkit 1.0
 * Dependency-free, ES3-style JavaScript.
 * All operations are local transformations or analysis. No network access.
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

  function trimText(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function padLeft(value, width, character) {
    var text = String(value);
    character = character || "0";
    while (text.length < width) {
      text = character + text;
    }
    return text;
  }

  function unsigned(value) {
    return value >>> 0;
  }

  function utf8Bytes(text) {
    var source = String(text == null ? "" : text);
    var bytes = [];
    var i;
    var code;
    var next;
    for (i = 0; i < source.length; i += 1) {
      code = source.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < source.length) {
        next = source.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i += 1;
        }
      }
      if (code < 0x80) {
        bytes[bytes.length] = code;
      } else if (code < 0x800) {
        bytes[bytes.length] = 0xC0 | (code >> 6);
        bytes[bytes.length] = 0x80 | (code & 0x3F);
      } else if (code < 0x10000) {
        bytes[bytes.length] = 0xE0 | (code >> 12);
        bytes[bytes.length] = 0x80 | ((code >> 6) & 0x3F);
        bytes[bytes.length] = 0x80 | (code & 0x3F);
      } else {
        bytes[bytes.length] = 0xF0 | (code >> 18);
        bytes[bytes.length] = 0x80 | ((code >> 12) & 0x3F);
        bytes[bytes.length] = 0x80 | ((code >> 6) & 0x3F);
        bytes[bytes.length] = 0x80 | (code & 0x3F);
      }
    }
    return bytes;
  }

  function utf8Text(bytes) {
    var out = "";
    var i = 0;
    var first;
    var code;
    var second;
    var third;
    var fourth;
    while (i < bytes.length) {
      first = bytes[i] & 255;
      if (first < 0x80) {
        out += String.fromCharCode(first);
        i += 1;
      } else if ((first & 0xE0) === 0xC0 && i + 1 < bytes.length) {
        second = bytes[i + 1] & 0x3F;
        code = ((first & 0x1F) << 6) | second;
        out += String.fromCharCode(code);
        i += 2;
      } else if ((first & 0xF0) === 0xE0 && i + 2 < bytes.length) {
        second = bytes[i + 1] & 0x3F;
        third = bytes[i + 2] & 0x3F;
        code = ((first & 0x0F) << 12) | (second << 6) | third;
        out += String.fromCharCode(code);
        i += 3;
      } else if ((first & 0xF8) === 0xF0 && i + 3 < bytes.length) {
        second = bytes[i + 1] & 0x3F;
        third = bytes[i + 2] & 0x3F;
        fourth = bytes[i + 3] & 0x3F;
        code = ((first & 0x07) << 18) | (second << 12) | (third << 6) | fourth;
        code -= 0x10000;
        out += String.fromCharCode(0xD800 | (code >> 10));
        out += String.fromCharCode(0xDC00 | (code & 0x3FF));
        i += 4;
      } else {
        out += "\uFFFD";
        i += 1;
      }
    }
    return out;
  }

  function bytesToHex(bytes) {
    var out = "";
    var i;
    for (i = 0; i < bytes.length; i += 1) {
      out += padLeft((bytes[i] & 255).toString(16), 2, "0");
    }
    return out;
  }

  function hexToBytes(text) {
    var clean = String(text || "").replace(/\s+/g, "").replace(/^0x/i, "");
    var bytes = [];
    var i;
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
      throw new Error("invalid hexadecimal input");
    }
    for (i = 0; i < clean.length; i += 2) {
      bytes[bytes.length] = parseInt(clean.substr(i, 2), 16);
    }
    return bytes;
  }

  function base64EncodeBytes(bytes) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    var i;
    var a;
    var b;
    var c;
    var value;
    for (i = 0; i < bytes.length; i += 3) {
      a = bytes[i] & 255;
      b = i + 1 < bytes.length ? bytes[i + 1] & 255 : 0;
      c = i + 2 < bytes.length ? bytes[i + 2] & 255 : 0;
      value = (a << 16) | (b << 8) | c;
      out += alphabet.charAt((value >> 18) & 63);
      out += alphabet.charAt((value >> 12) & 63);
      out += i + 1 < bytes.length ? alphabet.charAt((value >> 6) & 63) : "=";
      out += i + 2 < bytes.length ? alphabet.charAt(value & 63) : "=";
    }
    return out;
  }

  function base64DecodeBytes(text) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var clean = String(text || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    var bytes = [];
    var i;
    var c1;
    var c2;
    var c3;
    var c4;
    var value;
    while (clean.length % 4 !== 0) {
      clean += "=";
    }
    if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(clean)) {
      throw new Error("invalid base64 input");
    }
    for (i = 0; i < clean.length; i += 4) {
      c1 = alphabet.indexOf(clean.charAt(i));
      c2 = alphabet.indexOf(clean.charAt(i + 1));
      c3 = clean.charAt(i + 2) === "=" ? 0 : alphabet.indexOf(clean.charAt(i + 2));
      c4 = clean.charAt(i + 3) === "=" ? 0 : alphabet.indexOf(clean.charAt(i + 3));
      if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) {
        throw new Error("invalid base64 input");
      }
      value = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
      bytes[bytes.length] = (value >> 16) & 255;
      if (clean.charAt(i + 2) !== "=") {
        bytes[bytes.length] = (value >> 8) & 255;
      }
      if (clean.charAt(i + 3) !== "=") {
        bytes[bytes.length] = value & 255;
      }
    }
    return bytes;
  }

  function rotateLeft(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
  }

  function rotateRight(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function safeAdd(a, b) {
    var low = (a & 0xFFFF) + (b & 0xFFFF);
    var high = (a >>> 16) + (b >>> 16) + (low >>> 16);
    return (high << 16) | (low & 0xFFFF);
  }

  function md5Cmn(q, a, b, x, s, t) {
    return safeAdd(rotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }

  function md5Ff(a, b, c, d, x, s, t) {
    return md5Cmn((b & c) | ((~b) & d), a, b, x, s, t);
  }

  function md5Gg(a, b, c, d, x, s, t) {
    return md5Cmn((b & d) | (c & (~d)), a, b, x, s, t);
  }

  function md5Hh(a, b, c, d, x, s, t) {
    return md5Cmn(b ^ c ^ d, a, b, x, s, t);
  }

  function md5Ii(a, b, c, d, x, s, t) {
    return md5Cmn(c ^ (b | (~d)), a, b, x, s, t);
  }

  function wordHexLittle(value) {
    return padLeft((value & 255).toString(16), 2, "0") +
      padLeft(((value >>> 8) & 255).toString(16), 2, "0") +
      padLeft(((value >>> 16) & 255).toString(16), 2, "0") +
      padLeft(((value >>> 24) & 255).toString(16), 2, "0");
  }

  function md5(text) {
    var bytes = utf8Bytes(text);
    var words = [];
    var bitLength = bytes.length * 8;
    var i;
    var a = 0x67452301;
    var b = -271733879;
    var c = -1732584194;
    var d = 0x10325476;
    var oldA;
    var oldB;
    var oldC;
    var oldD;
    for (i = 0; i < bytes.length; i += 1) {
      words[i >> 2] = (words[i >> 2] || 0) | ((bytes[i] & 255) << ((i % 4) * 8));
    }
    words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | (0x80 << ((bytes.length % 4) * 8));
    words[(((bytes.length + 8) >> 6) + 1) * 16 - 2] = bitLength & 0xFFFFFFFF;
    words[(((bytes.length + 8) >> 6) + 1) * 16 - 1] = Math.floor(bitLength / 0x100000000);
    for (i = 0; i < words.length; i += 16) {
      oldA = a;
      oldB = b;
      oldC = c;
      oldD = d;
      a = md5Ff(a, b, c, d, words[i] || 0, 7, -680876936);
      d = md5Ff(d, a, b, c, words[i + 1] || 0, 12, -389564586);
      c = md5Ff(c, d, a, b, words[i + 2] || 0, 17, 606105819);
      b = md5Ff(b, c, d, a, words[i + 3] || 0, 22, -1044525330);
      a = md5Ff(a, b, c, d, words[i + 4] || 0, 7, -176418897);
      d = md5Ff(d, a, b, c, words[i + 5] || 0, 12, 1200080426);
      c = md5Ff(c, d, a, b, words[i + 6] || 0, 17, -1473231341);
      b = md5Ff(b, c, d, a, words[i + 7] || 0, 22, -45705983);
      a = md5Ff(a, b, c, d, words[i + 8] || 0, 7, 1770035416);
      d = md5Ff(d, a, b, c, words[i + 9] || 0, 12, -1958414417);
      c = md5Ff(c, d, a, b, words[i + 10] || 0, 17, -42063);
      b = md5Ff(b, c, d, a, words[i + 11] || 0, 22, -1990404162);
      a = md5Ff(a, b, c, d, words[i + 12] || 0, 7, 1804603682);
      d = md5Ff(d, a, b, c, words[i + 13] || 0, 12, -40341101);
      c = md5Ff(c, d, a, b, words[i + 14] || 0, 17, -1502002290);
      b = md5Ff(b, c, d, a, words[i + 15] || 0, 22, 1236535329);
      a = md5Gg(a, b, c, d, words[i + 1] || 0, 5, -165796510);
      d = md5Gg(d, a, b, c, words[i + 6] || 0, 9, -1069501632);
      c = md5Gg(c, d, a, b, words[i + 11] || 0, 14, 643717713);
      b = md5Gg(b, c, d, a, words[i] || 0, 20, -373897302);
      a = md5Gg(a, b, c, d, words[i + 5] || 0, 5, -701558691);
      d = md5Gg(d, a, b, c, words[i + 10] || 0, 9, 38016083);
      c = md5Gg(c, d, a, b, words[i + 15] || 0, 14, -660478335);
      b = md5Gg(b, c, d, a, words[i + 4] || 0, 20, -405537848);
      a = md5Gg(a, b, c, d, words[i + 9] || 0, 5, 568446438);
      d = md5Gg(d, a, b, c, words[i + 14] || 0, 9, -1019803690);
      c = md5Gg(c, d, a, b, words[i + 3] || 0, 14, -187363961);
      b = md5Gg(b, c, d, a, words[i + 8] || 0, 20, 1163531501);
      a = md5Gg(a, b, c, d, words[i + 13] || 0, 5, -1444681467);
      d = md5Gg(d, a, b, c, words[i + 2] || 0, 9, -51403784);
      c = md5Gg(c, d, a, b, words[i + 7] || 0, 14, 1735328473);
      b = md5Gg(b, c, d, a, words[i + 12] || 0, 20, -1926607734);
      a = md5Hh(a, b, c, d, words[i + 5] || 0, 4, -378558);
      d = md5Hh(d, a, b, c, words[i + 8] || 0, 11, -2022574463);
      c = md5Hh(c, d, a, b, words[i + 11] || 0, 16, 1839030562);
      b = md5Hh(b, c, d, a, words[i + 14] || 0, 23, -35309556);
      a = md5Hh(a, b, c, d, words[i + 1] || 0, 4, -1530992060);
      d = md5Hh(d, a, b, c, words[i + 4] || 0, 11, 1272893353);
      c = md5Hh(c, d, a, b, words[i + 7] || 0, 16, -155497632);
      b = md5Hh(b, c, d, a, words[i + 10] || 0, 23, -1094730640);
      a = md5Hh(a, b, c, d, words[i + 13] || 0, 4, 681279174);
      d = md5Hh(d, a, b, c, words[i] || 0, 11, -358537222);
      c = md5Hh(c, d, a, b, words[i + 3] || 0, 16, -722521979);
      b = md5Hh(b, c, d, a, words[i + 6] || 0, 23, 76029189);
      a = md5Hh(a, b, c, d, words[i + 9] || 0, 4, -640364487);
      d = md5Hh(d, a, b, c, words[i + 12] || 0, 11, -421815835);
      c = md5Hh(c, d, a, b, words[i + 15] || 0, 16, 530742520);
      b = md5Hh(b, c, d, a, words[i + 2] || 0, 23, -995338651);
      a = md5Ii(a, b, c, d, words[i] || 0, 6, -198630844);
      d = md5Ii(d, a, b, c, words[i + 7] || 0, 10, 1126891415);
      c = md5Ii(c, d, a, b, words[i + 14] || 0, 15, -1416354905);
      b = md5Ii(b, c, d, a, words[i + 5] || 0, 21, -57434055);
      a = md5Ii(a, b, c, d, words[i + 12] || 0, 6, 1700485571);
      d = md5Ii(d, a, b, c, words[i + 3] || 0, 10, -1894986606);
      c = md5Ii(c, d, a, b, words[i + 10] || 0, 15, -1051523);
      b = md5Ii(b, c, d, a, words[i + 1] || 0, 21, -2054922799);
      a = md5Ii(a, b, c, d, words[i + 8] || 0, 6, 1873313359);
      d = md5Ii(d, a, b, c, words[i + 15] || 0, 10, -30611744);
      c = md5Ii(c, d, a, b, words[i + 6] || 0, 15, -1560198380);
      b = md5Ii(b, c, d, a, words[i + 13] || 0, 21, 1309151649);
      a = md5Ii(a, b, c, d, words[i + 4] || 0, 6, -145523070);
      d = md5Ii(d, a, b, c, words[i + 11] || 0, 10, -1120210379);
      c = md5Ii(c, d, a, b, words[i + 2] || 0, 15, 718787259);
      b = md5Ii(b, c, d, a, words[i + 9] || 0, 21, -343485551);
      a = safeAdd(a, oldA);
      b = safeAdd(b, oldB);
      c = safeAdd(c, oldC);
      d = safeAdd(d, oldD);
    }
    return wordHexLittle(a) + wordHexLittle(b) + wordHexLittle(c) + wordHexLittle(d);
  }

  function sha1(text) {
    var bytes = utf8Bytes(text);
    var words = [];
    var length = bytes.length;
    var bitLength = length * 8;
    var i;
    var j;
    var w = [];
    var a;
    var b;
    var c;
    var d;
    var e;
    var f;
    var k;
    var temp;
    var h0 = 0x67452301;
    var h1 = -271733879;
    var h2 = -1732584194;
    var h3 = 0x10325476;
    var h4 = -1009589776;
    for (i = 0; i < length; i += 1) {
      words[i >> 2] = (words[i >> 2] || 0) | ((bytes[i] & 255) << (24 - (i % 4) * 8));
    }
    words[length >> 2] = (words[length >> 2] || 0) | (0x80 << (24 - (length % 4) * 8));
    words[(((length + 8) >> 6) + 1) * 16 - 1] = bitLength;
    for (i = 0; i < words.length; i += 16) {
      for (j = 0; j < 16; j += 1) {
        w[j] = words[i + j] || 0;
      }
      for (j = 16; j < 80; j += 1) {
        w[j] = rotateLeft(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }
      a = h0;
      b = h1;
      c = h2;
      d = h3;
      e = h4;
      for (j = 0; j < 80; j += 1) {
        if (j < 20) {
          f = (b & c) | ((~b) & d);
          k = 0x5A827999;
        } else if (j < 40) {
          f = b ^ c ^ d;
          k = 0x6ED9EBA1;
        } else if (j < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = -1894007588;
        } else {
          f = b ^ c ^ d;
          k = -899497514;
        }
        temp = safeAdd(safeAdd(rotateLeft(a, 5), f), safeAdd(safeAdd(e, k), w[j]));
        e = d;
        d = c;
        c = rotateLeft(b, 30);
        b = a;
        a = temp;
      }
      h0 = safeAdd(h0, a);
      h1 = safeAdd(h1, b);
      h2 = safeAdd(h2, c);
      h3 = safeAdd(h3, d);
      h4 = safeAdd(h4, e);
    }
    return padLeft(unsigned(h0).toString(16), 8, "0") +
      padLeft(unsigned(h1).toString(16), 8, "0") +
      padLeft(unsigned(h2).toString(16), 8, "0") +
      padLeft(unsigned(h3).toString(16), 8, "0") +
      padLeft(unsigned(h4).toString(16), 8, "0");
  }

  function sha256(text) {
    var constants = [
      0x428A2F98, 0x71374491, -1245643825, -373957723, 0x3956C25B, 0x59F111F1, -1841331548, -1424204075,
      -670586216, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, -2132889090, -1680079193, -1046744716,
      -459576895, -272742522, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
      -1740746414, -1473132947, -1341970488, -1084653625, -958395405, -710438585, 0x06CA6351, 0x14292967,
      0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, -2117940946, -1838011259,
      -1564481375, -1474664885, -1035236496, -949202525, -778901479, -694614492, -200395387, 0x106AA070,
      0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
      0x748F82EE, 0x78A5636F, -2067236844, -1933114872, -1866530822, -1538233109, -1090935817, -965641998
    ];
    var bytes = utf8Bytes(text);
    var words = [];
    var bitLength = bytes.length * 8;
    var h = [0x6A09E667, -1150833019, 0x3C6EF372, -1521486534, 0x510E527F, -1694144372, 0x1F83D9AB, 0x5BE0CD19];
    var w = [];
    var i;
    var j;
    var a;
    var b;
    var c;
    var d;
    var e;
    var f;
    var g;
    var hh;
    var s0;
    var s1;
    var ch;
    var maj;
    var temp1;
    var temp2;
    for (i = 0; i < bytes.length; i += 1) {
      words[i >> 2] = (words[i >> 2] || 0) | ((bytes[i] & 255) << (24 - (i % 4) * 8));
    }
    words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | (0x80 << (24 - (bytes.length % 4) * 8));
    words[(((bytes.length + 8) >> 6) + 1) * 16 - 1] = bitLength;
    for (i = 0; i < words.length; i += 16) {
      for (j = 0; j < 16; j += 1) {
        w[j] = words[i + j] || 0;
      }
      for (j = 16; j < 64; j += 1) {
        s0 = rotateRight(w[j - 15], 7) ^ rotateRight(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        s1 = rotateRight(w[j - 2], 17) ^ rotateRight(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = safeAdd(safeAdd(w[j - 16], s0), safeAdd(w[j - 7], s1));
      }
      a = h[0];
      b = h[1];
      c = h[2];
      d = h[3];
      e = h[4];
      f = h[5];
      g = h[6];
      hh = h[7];
      for (j = 0; j < 64; j += 1) {
        s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        ch = (e & f) ^ ((~e) & g);
        temp1 = safeAdd(safeAdd(safeAdd(safeAdd(hh, s1), ch), constants[j]), w[j]);
        s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        maj = (a & b) ^ (a & c) ^ (b & c);
        temp2 = safeAdd(s0, maj);
        hh = g;
        g = f;
        f = e;
        e = safeAdd(d, temp1);
        d = c;
        c = b;
        b = a;
        a = safeAdd(temp1, temp2);
      }
      h[0] = safeAdd(h[0], a);
      h[1] = safeAdd(h[1], b);
      h[2] = safeAdd(h[2], c);
      h[3] = safeAdd(h[3], d);
      h[4] = safeAdd(h[4], e);
      h[5] = safeAdd(h[5], f);
      h[6] = safeAdd(h[6], g);
      h[7] = safeAdd(h[7], hh);
    }
    return padLeft(unsigned(h[0]).toString(16), 8, "0") +
      padLeft(unsigned(h[1]).toString(16), 8, "0") +
      padLeft(unsigned(h[2]).toString(16), 8, "0") +
      padLeft(unsigned(h[3]).toString(16), 8, "0") +
      padLeft(unsigned(h[4]).toString(16), 8, "0") +
      padLeft(unsigned(h[5]).toString(16), 8, "0") +
      padLeft(unsigned(h[6]).toString(16), 8, "0") +
      padLeft(unsigned(h[7]).toString(16), 8, "0");
  }

  function crc32(text) {
    var bytes = utf8Bytes(text);
    var crc = -1;
    var i;
    var j;
    for (i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (j = 0; j < 8; j += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? -306674912 : 0);
      }
    }
    return padLeft(unsigned(crc ^ -1).toString(16), 8, "0");
  }

  function fnv1a(text) {
    var bytes = utf8Bytes(text);
    var hash = 0x811C9DC5;
    var i;
    for (i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = unsigned(hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)));
    }
    return padLeft(unsigned(hash).toString(16), 8, "0");
  }

  function hashText(algorithm, text) {
    var name = String(algorithm || "").toLowerCase().replace(/-/g, "");
    if (name === "md5") {
      return md5(text);
    }
    if (name === "sha1") {
      return sha1(text);
    }
    if (name === "sha256") {
      return sha256(text);
    }
    if (name === "crc32") {
      return crc32(text);
    }
    if (name === "fnv1a" || name === "fnv") {
      return fnv1a(text);
    }
    throw new Error("supported hashes: md5, sha1, sha256, crc32, fnv1a");
  }

  function readInput(shell, args, stdinText, startIndex) {
    var start = typeof startIndex === "number" ? startIndex : 0;
    if (args[start] === "-f") {
      if (start + 1 >= args.length) {
        throw new Error("-f requires a virtual file");
      }
      return shell.readFile(args[start + 1]);
    }
    if (args.length > start) {
      return args.slice(start).join(" ");
    }
    return String(stdinText || "");
  }

  function urlEncode(text) {
    var bytes = utf8Bytes(text);
    var safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";
    var out = "";
    var i;
    var character;
    for (i = 0; i < bytes.length; i += 1) {
      character = String.fromCharCode(bytes[i]);
      if (safe.indexOf(character) !== -1) {
        out += character;
      } else {
        out += "%" + padLeft(bytes[i].toString(16).toUpperCase(), 2, "0");
      }
    }
    return out;
  }

  function urlDecode(text) {
    var source = String(text || "").replace(/\+/g, " ");
    var bytes = [];
    var i = 0;
    var code;
    while (i < source.length) {
      if (source.charAt(i) === "%") {
        if (i + 2 >= source.length || !/^[0-9a-fA-F]{2}$/.test(source.substr(i + 1, 2))) {
          throw new Error("invalid percent encoding");
        }
        bytes[bytes.length] = parseInt(source.substr(i + 1, 2), 16);
        i += 3;
      } else {
        code = source.charCodeAt(i);
        if (code < 128) {
          bytes[bytes.length] = code;
        } else {
          bytes = bytes.concat(utf8Bytes(source.charAt(i)));
        }
        i += 1;
      }
    }
    return utf8Text(bytes);
  }

  function rot13(text) {
    return String(text || "").replace(/[A-Za-z]/g, function (character) {
      var code = character.charCodeAt(0);
      var base = code >= 97 ? 97 : 65;
      return String.fromCharCode(base + ((code - base + 13) % 26));
    });
  }

  function entropyReport(text) {
    var source = String(text || "");
    var counts = {};
    var i;
    var key;
    var probability;
    var entropy = 0;
    var unique = 0;
    if (source.length === 0) {
      return "Length: 0\nUnique symbols: 0\nEntropy: 0.000 bits/symbol\nEstimated total: 0.000 bits";
    }
    for (i = 0; i < source.length; i += 1) {
      key = "c" + source.charCodeAt(i);
      counts[key] = (counts[key] || 0) + 1;
    }
    for (key in counts) {
      if (owns(counts, key)) {
        unique += 1;
        probability = counts[key] / source.length;
        entropy -= probability * (Math.log(probability) / Math.log(2));
      }
    }
    return "Length: " + source.length +
      "\nUnique symbols: " + unique +
      "\nEntropy: " + entropy.toFixed(3) + " bits/symbol" +
      "\nEstimated total: " + (entropy * source.length).toFixed(3) + " bits";
  }

  function extractStrings(text, minimum) {
    var source = String(text || "");
    var out = [];
    var current = "";
    var i;
    var code;
    for (i = 0; i < source.length; i += 1) {
      code = source.charCodeAt(i);
      if (code >= 32 && code <= 126) {
        current += source.charAt(i);
      } else {
        if (current.length >= minimum) {
          out[out.length] = current;
        }
        current = "";
      }
    }
    if (current.length >= minimum) {
      out[out.length] = current;
    }
    return out.join("\n");
  }

  function hexdump(text) {
    var bytes = utf8Bytes(text);
    var out = [];
    var offset;
    var i;
    var hex;
    var ascii;
    var value;
    for (offset = 0; offset < bytes.length; offset += 16) {
      hex = "";
      ascii = "";
      for (i = 0; i < 16; i += 1) {
        if (offset + i < bytes.length) {
          value = bytes[offset + i] & 255;
          hex += padLeft(value.toString(16), 2, "0") + (i === 7 ? "  " : " ");
          ascii += value >= 32 && value <= 126 ? String.fromCharCode(value) : ".";
        } else {
          hex += "   " + (i === 7 ? " " : "");
        }
      }
      out[out.length] = padLeft(offset.toString(16), 8, "0") + "  " + hex + " |" + ascii + "|";
    }
    return out.join("\n");
  }

  function prettyJson(text) {
    var parsed;
    if (global.JSON && global.JSON.parse && global.JSON.stringify) {
      try {
        parsed = global.JSON.parse(text);
        return global.JSON.stringify(parsed, null, 2);
      } catch (ignore) {
        return text;
      }
    }
    return text;
  }

  function inspectJwt(token) {
    var parts = trimText(token).split(".");
    var header;
    var payload;
    var note = "Inspection only: the signature is NOT verified.";
    if (parts.length < 2 || parts.length > 3) {
      throw new Error("JWT must have two or three dot-separated parts");
    }
    header = utf8Text(base64DecodeBytes(parts[0]));
    payload = utf8Text(base64DecodeBytes(parts[1]));
    if (/\"alg\"\s*:\s*\"none\"/i.test(header)) {
      note += "\nWARNING: header declares alg=none.";
    }
    return note +
      "\n\nHeader:\n" + prettyJson(header) +
      "\n\nPayload:\n" + prettyJson(payload) +
      "\n\nSignature: " + (parts.length === 3 && parts[2] ? "present (not checked)" : "missing");
  }

  function parseIpv4(text) {
    var parts = String(text || "").split(".");
    var value = 0;
    var i;
    var octet;
    if (parts.length !== 4) {
      throw new Error("invalid IPv4 address");
    }
    for (i = 0; i < 4; i += 1) {
      if (!/^\d{1,3}$/.test(parts[i])) {
        throw new Error("invalid IPv4 address");
      }
      octet = parseInt(parts[i], 10);
      if (octet < 0 || octet > 255) {
        throw new Error("invalid IPv4 address");
      }
      value = unsigned((value << 8) | octet);
    }
    return value;
  }

  function ipv4Text(value) {
    value = unsigned(value);
    return ((value >>> 24) & 255) + "." + ((value >>> 16) & 255) + "." + ((value >>> 8) & 255) + "." + (value & 255);
  }

  function ipCategory(address) {
    var first = (address >>> 24) & 255;
    var second = (address >>> 16) & 255;
    if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
      return "private";
    }
    if (first === 127) {
      return "loopback";
    }
    if (first === 169 && second === 254) {
      return "link-local";
    }
    if (first === 100 && second >= 64 && second <= 127) {
      return "carrier-grade NAT";
    }
    if (first >= 224 && first <= 239) {
      return "multicast";
    }
    if (first >= 240) {
      return "reserved";
    }
    return "public/unclassified";
  }

  function ipcalc(value) {
    var parts = String(value || "").split("/");
    var address;
    var prefix;
    var mask;
    var wildcard;
    var network;
    var broadcast;
    var total;
    var usable;
    var first;
    var last;
    if (parts.length !== 2) {
      throw new Error("usage: ipcalc ADDRESS/PREFIX");
    }
    address = parseIpv4(parts[0]);
    prefix = parseInt(parts[1], 10);
    if (!/^\d{1,2}$/.test(parts[1]) || prefix < 0 || prefix > 32) {
      throw new Error("prefix must be between 0 and 32");
    }
    mask = prefix === 0 ? 0 : unsigned(0xFFFFFFFF << (32 - prefix));
    wildcard = unsigned(~mask);
    network = unsigned(address & mask);
    broadcast = unsigned(network | wildcard);
    total = Math.pow(2, 32 - prefix);
    if (prefix <= 30) {
      usable = Math.max(0, total - 2);
      first = unsigned(network + 1);
      last = unsigned(broadcast - 1);
    } else {
      usable = total;
      first = network;
      last = broadcast;
    }
    return "Address: " + ipv4Text(address) +
      "\nPrefix: /" + prefix +
      "\nNetmask: " + ipv4Text(mask) +
      "\nWildcard: " + ipv4Text(wildcard) +
      "\nNetwork: " + ipv4Text(network) +
      "\nBroadcast: " + ipv4Text(broadcast) +
      "\nUsable range: " + ipv4Text(first) + " - " + ipv4Text(last) +
      "\nUsable hosts: " + usable +
      "\nCategory: " + ipCategory(address);
  }

  function parseHeaders(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n");
    var headers = {};
    var cookies = [];
    var status = "";
    var current = "";
    var i;
    var index;
    var name;
    var value;
    for (i = 0; i < lines.length; i += 1) {
      if (i === 0 && /^HTTP\//i.test(lines[i])) {
        status = lines[i];
        continue;
      }
      if (/^[ \t]/.test(lines[i]) && current) {
        headers[current] = headers[current] + " " + trimText(lines[i]);
        continue;
      }
      index = lines[i].indexOf(":");
      if (index <= 0) {
        continue;
      }
      name = trimText(lines[i].substring(0, index)).toLowerCase();
      value = trimText(lines[i].substring(index + 1));
      current = name;
      if (name === "set-cookie") {
        cookies[cookies.length] = value;
      } else if (headers[name]) {
        headers[name] = headers[name] + ", " + value;
      } else {
        headers[name] = value;
      }
    }
    return { status: status, headers: headers, cookies: cookies };
  }

  function headerCheck(text) {
    var parsed = parseHeaders(text);
    var headers = parsed.headers;
    var out = [];
    var csp = String(headers["content-security-policy"] || "").toLowerCase();
    var i;
    var cookie;
    if (parsed.status) {
      out[out.length] = "Status: " + parsed.status;
    }
    if (headers["strict-transport-security"]) {
      out[out.length] = "[OK] HSTS present";
    } else {
      out[out.length] = "[REVIEW] Strict-Transport-Security missing (relevant on HTTPS)";
    }
    if (headers["content-security-policy"]) {
      out[out.length] = "[OK] Content-Security-Policy present";
      if (csp.indexOf("'unsafe-inline'") !== -1) {
        out[out.length] = "[REVIEW] CSP permits 'unsafe-inline'";
      }
      if (csp.indexOf("'unsafe-eval'") !== -1) {
        out[out.length] = "[REVIEW] CSP permits 'unsafe-eval'";
      }
    } else {
      out[out.length] = "[REVIEW] Content-Security-Policy missing";
    }
    if (String(headers["x-content-type-options"] || "").toLowerCase() === "nosniff") {
      out[out.length] = "[OK] X-Content-Type-Options: nosniff";
    } else {
      out[out.length] = "[REVIEW] X-Content-Type-Options: nosniff missing";
    }
    if (headers["x-frame-options"] || csp.indexOf("frame-ancestors") !== -1) {
      out[out.length] = "[OK] Framing policy present";
    } else {
      out[out.length] = "[REVIEW] No X-Frame-Options or CSP frame-ancestors";
    }
    if (headers["referrer-policy"]) {
      out[out.length] = "[OK] Referrer-Policy present";
    } else {
      out[out.length] = "[REVIEW] Referrer-Policy missing";
    }
    if (headers["permissions-policy"]) {
      out[out.length] = "[OK] Permissions-Policy present";
    } else {
      out[out.length] = "[INFO] Permissions-Policy not present";
    }
    if (headers["cross-origin-opener-policy"]) {
      out[out.length] = "[OK] Cross-Origin-Opener-Policy present";
    } else {
      out[out.length] = "[INFO] Cross-Origin-Opener-Policy not present";
    }
    if (headers.server) {
      out[out.length] = "[INFO] Server header disclosed: " + headers.server;
    }
    if (headers["x-powered-by"]) {
      out[out.length] = "[REVIEW] X-Powered-By disclosed: " + headers["x-powered-by"];
    }
    if (parsed.cookies.length === 0) {
      out[out.length] = "[INFO] No Set-Cookie headers found";
    }
    for (i = 0; i < parsed.cookies.length; i += 1) {
      cookie = parsed.cookies[i];
      out[out.length] = "Cookie " + (i + 1) + ":";
      out[out.length] = /;\s*secure(?:;|$)/i.test(cookie) ? "  [OK] Secure" : "  [REVIEW] Secure missing";
      out[out.length] = /;\s*httponly(?:;|$)/i.test(cookie) ? "  [OK] HttpOnly" : "  [REVIEW] HttpOnly missing";
      out[out.length] = /;\s*samesite\s*=\s*(strict|lax|none)/i.test(cookie) ? "  [OK] SameSite present" : "  [REVIEW] SameSite missing";
    }
    out[out.length] = "\nContext matters: REVIEW means inspect manually, not a confirmed vulnerability.";
    return out.join("\n");
  }

  function hashIdentify(value) {
    var text = trimText(value);
    var out = [];
    if (!/^[0-9a-fA-F]+$/.test(text)) {
      return "Input is not a plain hexadecimal digest.";
    }
    if (text.length === 8) {
      out[out.length] = "Possible: CRC32, FNV-1a 32-bit";
    }
    if (text.length === 32) {
      out[out.length] = "Possible: MD5, NTLM, MD4";
    }
    if (text.length === 40) {
      out[out.length] = "Possible: SHA-1";
    }
    if (text.length === 56) {
      out[out.length] = "Possible: SHA-224";
    }
    if (text.length === 64) {
      out[out.length] = "Possible: SHA-256";
    }
    if (text.length === 96) {
      out[out.length] = "Possible: SHA-384";
    }
    if (text.length === 128) {
      out[out.length] = "Possible: SHA-512";
    }
    if (out.length === 0) {
      out[out.length] = "No common fixed-length hexadecimal hash identified.";
    }
    out[out.length] = "Length alone cannot prove the algorithm.";
    return out.join("\n");
  }

  function secureRandomAvailable() {
    return !!(global.crypto && global.crypto.getRandomValues && global.Uint8Array);
  }

  function randomIndex(maximum) {
    var values;
    var limit;
    var value;
    if (secureRandomAvailable()) {
      values = new global.Uint8Array(1);
      limit = 256 - (256 % maximum);
      do {
        global.crypto.getRandomValues(values);
        value = values[0];
      } while (value >= limit);
      return value % maximum;
    }
    return Math.floor(Math.random() * maximum);
  }

  function passgen(args) {
    var length = args.length > 0 ? parseInt(args[0], 10) : 20;
    var count = args.length > 1 ? parseInt(args[1], 10) : 1;
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
    var out = [];
    var line;
    var i;
    var j;
    if (isNaN(length) || length < 4 || length > 256) {
      throw new Error("password length must be 4-256");
    }
    if (isNaN(count) || count < 1 || count > 50) {
      throw new Error("count must be 1-50");
    }
    if (!secureRandomAvailable()) {
      out[out.length] = "WARNING: Web Crypto unavailable; legacy PRNG is not suitable for high-value secrets.";
    }
    for (i = 0; i < count; i += 1) {
      line = "";
      for (j = 0; j < length; j += 1) {
        line += alphabet.charAt(randomIndex(alphabet.length));
      }
      out[out.length] = line;
    }
    return out.join("\n");
  }

  function securityOverview() {
    return "PocketBox Offline Security Toolkit\n" +
      "All tools process local text or virtual files. No network requests are made.\n\n" +
      "Encoding and inspection:\n" +
      "  base64 [-d] [-f FILE] [TEXT]   hex [-d] [-f FILE] [TEXT]\n" +
      "  urlencode [-f FILE] [TEXT]     urldecode [-f FILE] [TEXT]\n" +
      "  rot13 [-f FILE] [TEXT]         hexdump [-f FILE] [TEXT]\n" +
      "  strings [-n MIN] [-f FILE]     jwt TOKEN\n\n" +
      "Hashes and analysis:\n" +
      "  hash ALGO [-f FILE] [TEXT]     md5/sha1/sha256 [-f FILE] [TEXT]\n" +
      "  hashid DIGEST                  entropy [-f FILE] [TEXT]\n" +
      "  ipcalc ADDRESS/PREFIX          headercheck [-f FILE]\n" +
      "  passgen [LENGTH] [COUNT]\n\n" +
      "Examples:\n" +
      "  echo admin | sha256\n" +
      "  base64 hello\n" +
      "  hash sha256 -f notes.txt\n" +
      "  cat headers.txt | headercheck\n" +
      "  ipcalc 192.168.10.25/24\n" +
      "  jwt eyJ...\n\n" +
      "JWT output does not verify signatures. Header findings require manual context.";
  }

  oldCommandHelp = PocketBox.prototype.commandHelp;
  PocketBox.prototype.commandHelp = function (args) {
    var details = {
      security: "security - list the offline defensive-security tools and examples",
      base64: "base64 [-d] [-f FILE] [TEXT] - Base64 encode/decode local text",
      hex: "hex [-d] [-f FILE] [TEXT] - hexadecimal encode/decode UTF-8 text",
      urlencode: "urlencode [-f FILE] [TEXT] - percent-encode UTF-8 text",
      urldecode: "urldecode [-f FILE] [TEXT] - decode percent-encoded text",
      rot13: "rot13 [-f FILE] [TEXT] - apply the reversible ROT13 transform",
      hash: "hash ALGO [-f FILE] [TEXT] - md5, sha1, sha256, crc32, or fnv1a",
      md5: "md5 [-f FILE] [TEXT] - calculate an MD5 digest for compatibility checks",
      sha1: "sha1 [-f FILE] [TEXT] - calculate a SHA-1 digest",
      sha256: "sha256 [-f FILE] [TEXT] - calculate a SHA-256 digest",
      hashid: "hashid DIGEST - suggest hash types from hexadecimal length",
      entropy: "entropy [-f FILE] [TEXT] - estimate Shannon entropy",
      hexdump: "hexdump [-f FILE] [TEXT] - display UTF-8 bytes in hex and ASCII",
      strings: "strings [-n MIN] [-f FILE] [TEXT] - extract printable ASCII runs",
      jwt: "jwt TOKEN - decode JWT header and payload without verifying the signature",
      ipcalc: "ipcalc ADDRESS/PREFIX - calculate an IPv4 subnet locally",
      headercheck: "headercheck [-f FILE] [TEXT] - review HTTP response security headers",
      passgen: "passgen [LENGTH] [COUNT] - generate strings; Web Crypto is used when available"
    };
    var base;
    if (args && args.length > 0 && details[String(args[0]).toLowerCase()]) {
      return details[String(args[0]).toLowerCase()];
    }
    base = invokeOld(this, oldCommandHelp, [args]);
    if (!args || args.length === 0) {
      base += "\n\nOffline security tools:\n" +
        "  base64 entropy hash hashid headercheck hexdump hex ipcalc jwt md5\n" +
        "  passgen rot13 security sha1 sha256 strings urldecode urlencode\n" +
        "Run 'security' for examples and safety notes.";
    }
    return base;
  };

  oldResetFileSystem = PocketBox.prototype.resetFileSystem;
  PocketBox.prototype.resetFileSystem = function () {
    invokeOld(this, oldResetFileSystem, []);
    this.writeFile("/docs/SECURITY.txt", securityOverview() + "\n", false);
  };

  oldRunCommand = PocketBox.prototype.runCommand;
  PocketBox.prototype.runCommand = function (command, args, stdinText) {
    var input;
    var decode = false;
    var index = 0;
    var minimum = 4;
    var algorithm;
    if (command === "security" || command === "sectools") {
      return securityOverview();
    }
    if (command === "base64") {
      if (args[0] === "-d" || args[0] === "--decode") {
        decode = true;
        index = 1;
      }
      input = readInput(this, args, stdinText, index);
      return decode ? utf8Text(base64DecodeBytes(input)) : base64EncodeBytes(utf8Bytes(input));
    }
    if (command === "hex") {
      if (args[0] === "-d" || args[0] === "--decode") {
        decode = true;
        index = 1;
      }
      input = readInput(this, args, stdinText, index);
      return decode ? utf8Text(hexToBytes(input)) : bytesToHex(utf8Bytes(input));
    }
    if (command === "urlencode" || command === "urldecode" || command === "rot13") {
      input = readInput(this, args, stdinText, 0);
      if (command === "urlencode") {
        return urlEncode(input);
      }
      if (command === "urldecode") {
        return urlDecode(input);
      }
      return rot13(input);
    }
    if (command === "hash") {
      if (args.length === 0) {
        throw new Error("usage: hash ALGO [-f FILE] [TEXT]");
      }
      algorithm = args[0];
      input = readInput(this, args, stdinText, 1);
      return hashText(algorithm, input);
    }
    if (command === "md5" || command === "sha1" || command === "sha256" || command === "crc32" || command === "fnv1a") {
      input = readInput(this, args, stdinText, 0);
      return hashText(command, input);
    }
    if (command === "hashid") {
      input = readInput(this, args, stdinText, 0);
      return hashIdentify(input);
    }
    if (command === "entropy") {
      input = readInput(this, args, stdinText, 0);
      return entropyReport(input);
    }
    if (command === "hexdump" || command === "xxd") {
      input = readInput(this, args, stdinText, 0);
      return hexdump(input);
    }
    if (command === "strings") {
      if (args[0] === "-n") {
        if (args.length < 2) {
          throw new Error("-n requires a minimum length");
        }
        minimum = parseInt(args[1], 10);
        if (isNaN(minimum) || minimum < 1 || minimum > 1024) {
          throw new Error("minimum length must be 1-1024");
        }
        index = 2;
      }
      input = readInput(this, args, stdinText, index);
      return extractStrings(input, minimum);
    }
    if (command === "jwt" || command === "jwtdecode") {
      input = readInput(this, args, stdinText, 0);
      return inspectJwt(input);
    }
    if (command === "ipcalc") {
      if (args.length !== 1) {
        throw new Error("usage: ipcalc ADDRESS/PREFIX");
      }
      return ipcalc(args[0]);
    }
    if (command === "headercheck" || command === "headers") {
      input = readInput(this, args, stdinText, 0);
      if (!trimText(input)) {
        throw new Error("provide HTTP response headers through text, -f FILE, or a pipeline");
      }
      return headerCheck(input);
    }
    if (command === "passgen") {
      return passgen(args);
    }
    return invokeOld(this, oldRunCommand, [command, args, stdinText]);
  };
}(this));
