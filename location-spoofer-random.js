/* Experimental Shadowrocket V6.1. Coordinates-only patch; diagnostic notifications. Based on the supplied script. Not validated against live iOS 26.2 WLoc traffic. */
(function () {
  "use strict";

  // ===================== 20 ĐIỂM GỐC DANH SÁCH =====================
  var RANDOM_LOCATIONS = [
    { lat: 16.066455, lng: 108.20673 },
    { lat: 16.066415, lng: 108.20671 },
    { lat: 16.06647, lng: 108.20671 },
    { lat: 16.0664, lng: 108.20675 },
    { lat: 16.066485, lng: 108.20674 },
    { lat: 16.06638, lng: 108.2067 },
    { lat: 16.0665, lng: 108.2067 },
    { lat: 16.0664334, lng: 108.2068088 },
    { lat: 16.06635, lng: 108.20675 },
    { lat: 16.06652, lng: 108.20676 },
    { lat: 16.06634, lng: 108.20668 },
    { lat: 16.06654, lng: 108.2067 },
    { lat: 16.06631, lng: 108.20673 },
    { lat: 16.06655, lng: 108.20678 },
    { lat: 16.0663, lng: 108.20667 },
    { lat: 16.06657, lng: 108.20675 },
    { lat: 16.06628, lng: 108.20671 },
    { lat: 16.06659, lng: 108.2067 },
    { lat: 16.06626, lng: 108.20672 },
    { lat: 16.0664334, lng: 108.2065369 },
  ];

  var DEFAULT_LAT = 16.0664334;
  var DEFAULT_LNG = 108.2067245;

  function pickRandomBaseLocation() {
    return RANDOM_LOCATIONS[
      Math.floor(Math.random() * RANDOM_LOCATIONS.length)
    ];
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) *
        Math.cos(lat2 * toRad) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  function addJitter(loc) {
    var latJitter = (Math.random() - 0.5) * 0.000015;
    var lngJitter = (Math.random() - 0.5) * 0.000015;
    return {
      lat: loc.lat + latJitter,
      lng: loc.lng + lngJitter,
    };
  }

  // A stable 30-minute window, NOT a VPN session detector.
  function getDynamicLocation() {
    var key = "GPS_V61_WINDOW",
      now = Date.now(),
      saved = null;
    try {
      saved = JSON.parse($persistentStore.read(key) || "null");
    } catch (_) {}
    if (
      saved &&
      Number.isFinite(saved.lat) &&
      Number.isFinite(saved.lng) &&
      now >= saved.time &&
      now - saved.time < 1800000
    )
      return saved;
    var candidates = RANDOM_LOCATIONS.filter(function (p) {
      return !saved || p.lat !== saved.lat || p.lng !== saved.lng;
    });
    var loc = candidates[Math.floor(Math.random() * candidates.length)];
    var result = { lat: loc.lat, lng: loc.lng, time: now };
    if (typeof $persistentStore !== "undefined")
      $persistentStore.write(JSON.stringify(result), key);
    return result;
  }

  var DEFAULT_CONFIG = {
    enabled: true,
    mode: "response",
    latitude: DEFAULT_LAT,
    longitude: DEFAULT_LNG,
    horizontalAccuracy: 10,
    verticalAccuracy: 5,
    altitude: 12,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467,
    failOpen: true,
  };

  var APPLE_WLOC_PREFIX = bytesFromArray([
    0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
  ]);
  var APPLE_WLOC_MARKER = bytesFromArray([0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  var ROOT_DROP_FIELDS = { 3: true, 4: true, 33: true };
  var CELL_RESPONSE_FIELDS = { 22: true, 24: true };
  var LOCATION_REPLACED_FIELDS = {
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    11: true,
    12: true,
  };

  function bytesFromArray(values) {
    return new Uint8Array(values);
  }

  function concatBytes(parts) {
    var total = 0,
      i;
    for (i = 0; i < parts.length; i += 1) total += parts[i].length;
    var out = new Uint8Array(total),
      offset = 0;
    for (i = 0; i < parts.length; i += 1) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  function findBytes(bytes, marker) {
    if (!bytes || !marker || marker.length === 0) return -1;
    for (var i = 0; i <= bytes.length - marker.length; i += 1) {
      var ok = true;
      for (var j = 0; j < marker.length; j += 1) {
        if (bytes[i + j] !== marker[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }
    return -1;
  }

  function tryParseFields(bytes) {
    try {
      if (!bytes || bytes.length === 0) return null;
      var fields = parseFields(bytes);
      return fields.length > 0 ? fields : null;
    } catch (e) {
      return null;
    }
  }

  function binaryStringToBytes(value) {
    var out = new Uint8Array(value.length);
    for (var i = 0; i < value.length; i += 1)
      out[i] = value.charCodeAt(i) & 0xff;
    return out;
  }

  function bodyToBytes(body) {
    if (body == null) return null;
    if (body instanceof Uint8Array) return body;
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer)
      return new Uint8Array(body);
    if (typeof body === "string") return binaryStringToBytes(body);
    if (typeof body === "object" && typeof body.length === "number")
      return new Uint8Array(body);
    if (
      typeof body === "object" &&
      body.bytes &&
      typeof body.bytes.length === "number"
    )
      return new Uint8Array(body.bytes);
    if (
      typeof body === "object" &&
      body.data &&
      typeof body.data.length === "number"
    )
      return new Uint8Array(body.data);
    return null;
  }

  function messageBodyToBytes(message) {
    if (!message) return null;
    return (
      bodyToBytes(message.bodyBytes) ||
      bodyToBytes(message.body) ||
      bodyToBytes(message.rawBody) ||
      bodyToBytes(message.binaryBody)
    );
  }

  function readUInt16BE(bytes, offset) {
    if (offset + 2 > bytes.length) throw new Error("uint16 out of range");
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readUInt32BE(bytes, offset) {
    if (offset + 4 > bytes.length) throw new Error("uint32 out of range");
    return (
      (bytes[offset] * 0x1000000 +
        ((bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3])) >>>
      0
    );
  }

  function writeUInt16BE(value) {
    if (value < 0 || value > 0xffff)
      throw new Error("uint16 value out of range: " + value);
    return bytesFromArray([(value >> 8) & 0xff, value & 0xff]);
  }

  function writeUInt32BE(value) {
    return bytesFromArray([
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  function asciiBytes(value) {
    var out = new Uint8Array(value.length);
    for (var i = 0; i < value.length; i += 1)
      out[i] = value.charCodeAt(i) & 0x7f;
    return out;
  }

  function encodeVarintUnsigned(value) {
    var v = typeof value === "bigint" ? value : BigInt(value);
    if (v < 0n) throw new Error("negative unsigned varint");
    var out = [];
    while (v >= 0x80n) {
      out.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    out.push(Number(v));
    return bytesFromArray(out);
  }

  function encodeVarintSignedInt64(value) {
    var v = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
    if (v < 0n) v = BigInt.asUintN(64, v);
    return encodeVarintUnsigned(v);
  }

  function decodeVarint(bytes, offset) {
    var result = 0n,
      shift = 0n,
      current = offset;
    while (current < bytes.length) {
      var b = bytes[current];
      current += 1;
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return { value: result, offset: current };
      shift += 7n;
      if (shift > 70n) throw new Error("varint too long");
    }
    throw new Error("unterminated varint");
  }

  function makeKey(fieldNumber, wireType) {
    return encodeVarintUnsigned((BigInt(fieldNumber) << 3n) | BigInt(wireType));
  }

  function makeVarintField(fieldNumber, value) {
    return concatBytes([
      makeKey(fieldNumber, 0),
      encodeVarintSignedInt64(value),
    ]);
  }

  function makeLengthDelimitedField(fieldNumber, payload) {
    return concatBytes([
      makeKey(fieldNumber, 2),
      encodeVarintUnsigned(payload.length),
      payload,
    ]);
  }

  function parseFields(bytes) {
    var fields = [],
      offset = 0;
    while (offset < bytes.length) {
      var keyStart = offset;
      var key = decodeVarint(bytes, offset);
      offset = key.offset;
      var fieldNumber = Number(key.value >> 3n);
      var wireType = Number(key.value & 0x7n);
      if (fieldNumber === 0) throw new Error("protobuf field number 0");
      var valueStart = offset,
        valueEnd;
      if (wireType === 0) {
        valueEnd = decodeVarint(bytes, offset).offset;
      } else if (wireType === 1) {
        valueEnd = offset + 8;
      } else if (wireType === 2) {
        var lengthInfo = decodeVarint(bytes, offset);
        var length = Number(lengthInfo.value);
        valueStart = lengthInfo.offset;
        valueEnd = valueStart + length;
      } else if (wireType === 5) {
        valueEnd = offset + 4;
      } else {
        throw new Error("unsupported protobuf wire type: " + wireType);
      }
      if (valueEnd > bytes.length)
        throw new Error("protobuf field exceeds buffer");
      fields.push({
        fieldNumber: fieldNumber,
        wireType: wireType,
        keyStart: keyStart,
        valueStart: valueStart,
        valueEnd: valueEnd,
        end: valueEnd,
        raw: bytes.slice(keyStart, valueEnd),
        valueBytes: bytes.slice(valueStart, valueEnd),
      });
      offset = valueEnd;
    }
    return fields;
  }

  function isCellResponseField(fieldNumber) {
    return CELL_RESPONSE_FIELDS[fieldNumber] === true;
  }

  function coordToInt(value) {
    return Math.trunc(Number(value) * 100000000);
  }

  function parseBoolean(value, defaultValue) {
    if (value === true || value === false) return value;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (
        normalized === "true" ||
        normalized === "1" ||
        normalized === "yes" ||
        normalized === "on"
      )
        return true;
      if (
        normalized === "false" ||
        normalized === "0" ||
        normalized === "no" ||
        normalized === "off"
      )
        return false;
    }
    return defaultValue;
  }

  function normalizeConfig(input) {
    var cfg = {},
      key;
    for (key in DEFAULT_CONFIG) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key))
        cfg[key] = DEFAULT_CONFIG[key];
    }
    input = input || {};
    for (key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key))
        cfg[key] = input[key];
    }
    cfg.enabled = parseBoolean(cfg.enabled, true);
    cfg.failOpen = parseBoolean(cfg.failOpen, true);
    cfg.latitude = Number(cfg.latitude);
    cfg.longitude = Number(cfg.longitude);
    return cfg;
  }

  var patchedCoordinateCount = 0;
  function patchLocation(locationPayload, config) {
    var fields = parseFields(locationPayload),
      parts = [];
    var hasLat = fields.some(function (f) {
      return f.fieldNumber === 1 && f.wireType === 0;
    });
    var hasLng = fields.some(function (f) {
      return f.fieldNumber === 2 && f.wireType === 0;
    });
    if (!hasLat || !hasLng) return locationPayload;
    fields.forEach(function (f) {
      if (f.fieldNumber === 1 && f.wireType === 0)
        parts.push(makeVarintField(1, coordToInt(config.latitude)));
      else if (f.fieldNumber === 2 && f.wireType === 0)
        parts.push(makeVarintField(2, coordToInt(config.longitude)));
      else parts.push(f.raw);
    });
    patchedCoordinateCount += 1;
    return concatBytes(parts);
  }

  function patchWifiDevice(wifiPayload, config) {
    var fields = parseFields(wifiPayload),
      parts = [],
      patchedLocation = false;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 2 && field.wireType === 2) {
        parts.push(
          makeLengthDelimitedField(2, patchLocation(field.valueBytes, config)),
        );
        patchedLocation = true;
      } else {
        parts.push(field.raw);
      }
    }
    // No known location field: preserve record unchanged.
    return concatBytes(parts);
  }

  function patchCellTower(cellPayload, config) {
    var fields = parseFields(cellPayload),
      parts = [],
      patchedLocation = false;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 5 && field.wireType === 2) {
        parts.push(
          makeLengthDelimitedField(5, patchLocation(field.valueBytes, config)),
        );
        patchedLocation = true;
      } else {
        parts.push(field.raw);
      }
    }
    // No known location field: preserve record unchanged.
    return concatBytes(parts);
  }

  function patchAppleWLocPayload(payload, config) {
    var fields = parseFields(payload),
      parts = [],
      wifiCount = 0,
      cellCount = 0;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 2 && field.wireType === 2) {
        parts.push(
          makeLengthDelimitedField(
            2,
            patchWifiDevice(field.valueBytes, config),
          ),
        );
        wifiCount += 1;
      } else if (
        isCellResponseField(field.fieldNumber) &&
        field.wireType === 2
      ) {
        parts.push(
          makeLengthDelimitedField(
            field.fieldNumber,
            patchCellTower(field.valueBytes, config),
          ),
        );
        cellCount += 1;
      } else {
        parts.push(field.raw);
      }
    }
    return {
      payload: concatBytes(parts),
      wifiCount: wifiCount,
      cellCount: cellCount,
    };
  }

  function readPascalString(bytes, state) {
    var length = readUInt16BE(bytes, state.offset);
    state.offset += 2;
    if (state.offset + length > bytes.length)
      throw new Error("ARPC pascal string exceeds buffer");
    var chars = [];
    for (var i = 0; i < length; i += 1)
      chars.push(String.fromCharCode(bytes[state.offset + i]));
    state.offset += length;
    return chars.join("");
  }

  function writePascalString(value) {
    var bytes = asciiBytes(value);
    return concatBytes([writeUInt16BE(bytes.length), bytes]);
  }

  function parseArpc(bytes) {
    var state = { offset: 0 };
    var version = readUInt16BE(bytes, state.offset);
    state.offset += 2;
    var locale = readPascalString(bytes, state);
    var appIdentifier = readPascalString(bytes, state);
    var osVersion = readPascalString(bytes, state);
    var functionId = readUInt32BE(bytes, state.offset);
    state.offset += 4;
    var payloadLength = readUInt32BE(bytes, state.offset);
    state.offset += 4;
    if (state.offset + payloadLength > bytes.length)
      throw new Error("ARPC payload exceeds buffer");
    return {
      version: version,
      locale: locale,
      appIdentifier: appIdentifier,
      osVersion: osVersion,
      functionId: functionId,
      payload: bytes.slice(state.offset, state.offset + payloadLength),
    };
  }

  function serializeArpc(arpc) {
    return concatBytes([
      writeUInt16BE(arpc.version),
      writePascalString(arpc.locale),
      writePascalString(arpc.appIdentifier),
      writePascalString(arpc.osVersion),
      writeUInt32BE(arpc.functionId),
      writeUInt32BE(arpc.payload.length),
      arpc.payload,
    ]);
  }

  function buildAppleWLocResponse(payload, prefix) {
    return concatBytes([
      prefix || APPLE_WLOC_PREFIX,
      writeUInt16BE(payload.length),
      payload,
    ]);
  }

  function extractPrefixedAppleWLocPayload(responseBytes) {
    if (!responseBytes || responseBytes.length < 10) return null;
    if (responseBytes[0] !== 0x00 || responseBytes[1] !== 0x01) return null;
    if (responseBytes[6] !== 0x00 || responseBytes[7] !== 0x00) return null;
    var payloadLength = readUInt16BE(responseBytes, 8);
    var payloadOffset = 10;
    if (
      payloadLength <= 0 ||
      payloadOffset + payloadLength > responseBytes.length
    )
      return null;
    var payload = responseBytes.slice(
      payloadOffset,
      payloadOffset + payloadLength,
    );
    if (tryParseFields(payload) === null) return null;
    return {
      kind: "synthetic",
      payload: payload,
      prefix: responseBytes.slice(0, 8),
      suffix: responseBytes.slice(payloadOffset + payloadLength),
    };
  }

  function extractAppleWLocPayload(responseBytes) {
    if (!responseBytes || responseBytes.length < 2)
      throw new Error("Apple WLoc response too short");
    var prefixed = extractPrefixedAppleWLocPayload(responseBytes);
    if (prefixed) return prefixed;
    try {
      var arpc = parseArpc(responseBytes);
      if (arpc.payload.length > 0 && tryParseFields(arpc.payload) !== null) {
        return { kind: "arpc", payload: arpc.payload, arpc: arpc };
      }
    } catch (e) {}
    throw new Error("missing Apple WLoc response prefix");
  }

  function looksLikeAppleWLocPayload(bytes) {
    if (!bytes || bytes.length === 0) return false;
    var tag = bytes[0];
    var fieldNumber = tag >> 3;
    var wireType = tag & 0x7;
    return fieldNumber > 0 && (wireType === 0 || wireType === 2);
  }

  function spoofAppleResponse(responseBytes, configInput) {
    var config = normalizeConfig(configInput);
    var extraction = extractAppleWLocPayload(responseBytes);
    patchedCoordinateCount = 0;
    var patched = patchAppleWLocPayload(extraction.payload, config);
    if (patchedCoordinateCount === 0)
      throw new Error("No coordinate pairs modified");
    var response;
    if (extraction.kind === "arpc") {
      var arpcOut = {
        version: extraction.arpc.version,
        locale: extraction.arpc.locale,
        appIdentifier: extraction.arpc.appIdentifier,
        osVersion: extraction.arpc.osVersion,
        functionId: extraction.arpc.functionId,
        payload: patched.payload,
      };
      response = serializeArpc(arpcOut);
    } else if (extraction.kind === "marker") {
      var newLenBytes = writeUInt16BE(patched.payload.length);
      response = concatBytes([
        extraction.prefix,
        extraction.markerAndLen.slice(0, APPLE_WLOC_MARKER.length),
        newLenBytes,
        patched.payload,
        extraction.suffix,
      ]);
    } else {
      response =
        extraction.kind === "bare"
          ? patched.payload
          : concatBytes([
              buildAppleWLocResponse(patched.payload, extraction.prefix),
              extraction.suffix || bytesFromArray([]),
            ]);
    }
    return { response: response, count: patchedCoordinateCount };
  }

  function headersWithBinaryBody(sourceHeaders, length) {
    var headers = {},
      key;
    sourceHeaders = sourceHeaders || {};
    for (key in sourceHeaders) {
      if (Object.prototype.hasOwnProperty.call(sourceHeaders, key)) {
        var lower = key.toLowerCase();
        if (
          lower !== "content-length" &&
          lower !== "content-encoding" &&
          lower !== "transfer-encoding"
        ) {
          headers[key] = sourceHeaders[key];
        }
      }
    }
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Length"] = String(length);
    return headers;
  }

  function donePassThrough() {
    $done({});
  }

  function doneRewriteResponse(bytes) {
    var sourceHeaders =
      typeof $response !== "undefined" ? $response.headers : {};
    var headers = headersWithBinaryBody(sourceHeaders, bytes.length);
    if (typeof $loon !== "undefined") {
      $done({
        status: ($response && $response.status) || 200,
        headers: headers,
        body: bytes,
      });
      return;
    }
    $done({ headers: headers, body: bytes });
  }

  function reportResult(kind, message) {
    try {
      var now = Date.now(),
        key = "GPS_V61_NOTICE_" + kind;
      var last = Number($persistentStore.read(key) || 0);
      if (now - last < 60000) return;
      $persistentStore.write(String(now), key);
      if (typeof $notification !== "undefined")
        $notification.post(
          "GPS V6.1: " + kind,
          "Ket qua xu ly phan hoi",
          message,
        );
    } catch (_) {}
  }

  function runShadowrocket() {
    if (typeof $response === "undefined" || !$response) {
      donePassThrough();
      return;
    }

    try {
      var statusMatch = String(
        $response.status || $response.statusCode || 200,
      ).match(/\b([1-5][0-9]{2})\b/);
      var status = statusMatch ? Number(statusMatch[1]) : 0;
      if (status !== 200) throw new Error("HTTP status " + status);
      var currentLoc = getDynamicLocation();

      var responseBody = messageBodyToBytes($response);
      if (!responseBody || responseBody.length < 2) {
        reportResult(
          "empty",
          "Script da chay nhung khong co body nhi phan de xu ly.",
        );
        donePassThrough();
        return;
      }

      var responseResult = spoofAppleResponse(responseBody, {
        latitude: currentLoc.lat,
        longitude: currentLoc.lng,
      });

      console.log(
        "[GPS V6.1] Response rewritten; Maps acceptance is not verified. " +
          currentLoc.lat +
          "," +
          currentLoc.lng,
      );
      reportResult(
        "rewritten",
        "Da sua " +
          responseResult.count +
          " cap toa do thanh " +
          currentLoc.lat +
          ", " +
          currentLoc.lng +
          ". Chua xac nhan Maps chap nhan.",
      );
      doneRewriteResponse(responseResult.response);
    } catch (err) {
      console.log("[GPS V6.1] Original response preserved: " + String(err));
      reportResult(
        "passthrough",
        "Khong sua toa do; giu phan hoi goc. " + String(err),
      );
      donePassThrough();
    }
  }

  runShadowrocket();
})();
