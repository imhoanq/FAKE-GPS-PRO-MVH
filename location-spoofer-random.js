/*
 * iOS Location Spoofer - Session Location + VPN Reset
 *
 * - Trong cùng một phiên VPN: luôn giữ nguyên một tọa độ.
 * - Khi nhận sự kiện network-changed: kết thúc phiên hiện tại.
 * - Ở request định vị đầu tiên của phiên mới: cách vị trí cũ ít nhất 1m.
 * - Chỉ thông báo sau khi dữ liệu định vị đã được sửa thành công.
 *
 * LƯU Ý: Ngoài rule http-response hiện tại, cần gọi chính file này bằng một
 * event script "network-changed" thì script mới biết VPN/mạng vừa được bật lại.
 */
(function () {
  "use strict";

  // ===================== 20 ĐIỂM GỐC DANH SÁCH =====================
  var RANDOM_LOCATIONS = [
    { lat: 16.0664550, lng: 108.2067300 },
    { lat: 16.0664150, lng: 108.2067100 },
    { lat: 16.0664700, lng: 108.2067100 },
    { lat: 16.0664000, lng: 108.2067500 },
    { lat: 16.0664850, lng: 108.2067400 },
    { lat: 16.0663800, lng: 108.2067000 },
    { lat: 16.0665000, lng: 108.2067000 },
    { lat: 16.0664334, lng: 108.2068088 },
    { lat: 16.0663500, lng: 108.2067500 },
    { lat: 16.0665200, lng: 108.2067600 },
    { lat: 16.0663400, lng: 108.2066800 },
    { lat: 16.0665400, lng: 108.2067000 },
    { lat: 16.0663100, lng: 108.2067300 },
    { lat: 16.0665500, lng: 108.2067800 },
    { lat: 16.0663000, lng: 108.2066700 },
    { lat: 16.0665700, lng: 108.2067500 },
    { lat: 16.0662800, lng: 108.2067100 },
    { lat: 16.0665900, lng: 108.2067000 },
    { lat: 16.0662600, lng: 108.2067200 },
    { lat: 16.0664334, lng: 108.2065369 }
  ];

  // Tọa độ mốc của Cà Phê Muối Chú Long dùng để tính khoảng cách.
  var CAFE_NAME = "Cà Phê Muối Chú Long";
  var DEFAULT_LAT = 16.0664334;
  var DEFAULT_LNG = 108.2067245;

  var STORE_LAT_KEY = "SESSION_FAKE_LAT";
  var STORE_LNG_KEY = "SESSION_FAKE_LNG";
  var STORE_ACTIVE_KEY = "SESSION_FAKE_ACTIVE";
  var STORE_NOTIFY_KEY = "SESSION_FAKE_LAST_NOTIFIED_LOCATION_V2";
  var MIN_NEW_LOCATION_DISTANCE_METERS = 1;

  function pickRandomBaseLocation() {
    return RANDOM_LOCATIONS[Math.floor(Math.random() * RANDOM_LOCATIONS.length)];
  }

  function distanceMetersExact(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    return Math.round(distanceMetersExact(lat1, lng1, lat2, lng2));
  }

  function addJitter(loc) {
    var latJitter = (Math.random() - 0.5) * 0.000015;
    var lngJitter = (Math.random() - 0.5) * 0.000015;
    return {
      lat: loc.lat + latJitter,
      lng: loc.lng + lngJitter
    };
  }

  function readStoredValue(key, fallback) {
    if (typeof $persistentStore === "undefined") return fallback;
    var value = $persistentStore.read(key);
    return value == null || value === "" ? fallback : value;
  }

  function writeStoredValue(value, key) {
    if (typeof $persistentStore !== "undefined") {
      $persistentStore.write(String(value), key);
    }
  }

  function createNewLocation(previousLat, previousLng) {
    var candidate;
    var attempts = 0;

    do {
      candidate = addJitter(pickRandomBaseLocation());
      attempts += 1;
    } while (
      attempts < 50 &&
      isFinite(previousLat) &&
      isFinite(previousLng) &&
      previousLat !== 0 &&
      previousLng !== 0 &&
      distanceMetersExact(previousLat, previousLng, candidate.lat, candidate.lng) <
        MIN_NEW_LOCATION_DISTANCE_METERS
    );

    return candidate;
  }

  function getDynamicLocation() {
    // ===================== SESSION LOCATION =====================
    // Random đúng 1 lần rồi lưu lại.
    // Các request sau luôn dùng đúng tọa độ đã lưu, không tự đổi vị trí.
    var savedLat = parseFloat(readStoredValue(STORE_LAT_KEY, "0"));
    var savedLng = parseFloat(readStoredValue(STORE_LNG_KEY, "0"));
    var sessionActive = readStoredValue(STORE_ACTIVE_KEY, "0") === "1";

    // Phiên còn hoạt động và tọa độ hợp lệ -> giữ nguyên tuyệt đối.
    if (
      sessionActive &&
      isFinite(savedLat) &&
      isFinite(savedLng) &&
      savedLat !== 0 &&
      savedLng !== 0
    ) {
      return { lat: savedLat, lng: savedLng, isNew: false };
    }

    // Phiên mới -> chỉ chuẩn bị vị trí mới. Chưa lưu/khóa phiên ở đây vì
    // phản hồi định vị có thể không hợp lệ hoặc quá trình patch có thể lỗi.
    // Chỉ commit sau khi spoofAppleResponse chạy thành công.
    var finalLoc = createNewLocation(savedLat, savedLng);
    return { lat: finalLoc.lat, lng: finalLoc.lng, isNew: true };
  }

  function commitNewLocation(loc) {
    writeStoredValue(loc.lat, STORE_LAT_KEY);
    writeStoredValue(loc.lng, STORE_LNG_KEY);
    writeStoredValue("1", STORE_ACTIVE_KEY);
  }

  function endLocationSession() {
    // Giữ tọa độ cũ để phiên sau có thể tránh chọn lại đúng điểm đó.
    writeStoredValue("0", STORE_ACTIVE_KEY);
  }

  function notifyNewLocation(loc) {
  if (typeof $notification === "undefined") return;

  var locationId = loc.lat.toFixed(7) + "," + loc.lng.toFixed(7);

  if (readStoredValue(STORE_NOTIFY_KEY, "") === locationId) return;

  var distanceToCafe = distanceMeters(
    DEFAULT_LAT,
    DEFAULT_LNG,
    loc.lat,
    loc.lng
  );

  $notification.post(
    "📍 FAKE GPS ĐÃ BẬT",
    "Cách " + CAFE_NAME + ": " + distanceToCafe + " mét",
    "Tọa độ: " + loc.lat.toFixed(7) + ", " + loc.lng.toFixed(7)
  );

  writeStoredValue(locationId, STORE_NOTIFY_KEY);
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
    failOpen: true
  };

  var APPLE_WLOC_PREFIX = bytesFromArray([0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  var APPLE_WLOC_MARKER = bytesFromArray([0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  var ROOT_DROP_FIELDS = { 3: true, 4: true, 33: true };
  var CELL_RESPONSE_FIELDS = { 22: true, 24: true };
  var LOCATION_REPLACED_FIELDS = {
    1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 11: true, 12: true
  };

  function bytesFromArray(values) { return new Uint8Array(values); }

  function concatBytes(parts) {
    var total = 0, i;
    for (i = 0; i < parts.length; i += 1) total += parts[i].length;
    var out = new Uint8Array(total), offset = 0;
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
        if (bytes[i + j] !== marker[j]) { ok = false; break; }
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
    for (var i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
    return out;
  }

  function bodyToBytes(body) {
    if (body == null) return null;
    if (body instanceof Uint8Array) return body;
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof body === "string") return binaryStringToBytes(body);
    if (typeof body === "object" && typeof body.length === "number") return new Uint8Array(body);
    if (typeof body === "object" && body.bytes && typeof body.bytes.length === "number") return new Uint8Array(body.bytes);
    if (typeof body === "object" && body.data && typeof body.data.length === "number") return new Uint8Array(body.data);
    return null;
  }

  function messageBodyToBytes(message) {
    if (!message) return null;
    return bodyToBytes(message.bodyBytes) || bodyToBytes(message.body) || bodyToBytes(message.rawBody) || bodyToBytes(message.binaryBody);
  }

  function readUInt16BE(bytes, offset) {
    if (offset + 2 > bytes.length) throw new Error("uint16 out of range");
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readUInt32BE(bytes, offset) {
    if (offset + 4 > bytes.length) throw new Error("uint32 out of range");
    return ((bytes[offset] * 0x1000000) + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])) >>> 0;
  }

  function writeUInt16BE(value) {
    if (value < 0 || value > 0xffff) throw new Error("uint16 value out of range: " + value);
    return bytesFromArray([(value >> 8) & 0xff, value & 0xff]);
  }

  function writeUInt32BE(value) {
    return bytesFromArray([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
  }

  function asciiBytes(value) {
    var out = new Uint8Array(value.length);
    for (var i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0x7f;
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
    var result = 0n, shift = 0n, current = offset;
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
    return concatBytes([makeKey(fieldNumber, 0), encodeVarintSignedInt64(value)]);
  }

  function makeLengthDelimitedField(fieldNumber, payload) {
    return concatBytes([makeKey(fieldNumber, 2), encodeVarintUnsigned(payload.length), payload]);
  }

  function parseFields(bytes) {
    var fields = [], offset = 0;
    while (offset < bytes.length) {
      var keyStart = offset;
      var key = decodeVarint(bytes, offset);
      offset = key.offset;
      var fieldNumber = Number(key.value >> 3n);
      var wireType = Number(key.value & 0x7n);
      if (fieldNumber === 0) throw new Error("protobuf field number 0");
      var valueStart = offset, valueEnd;
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
      if (valueEnd > bytes.length) throw new Error("protobuf field exceeds buffer");
      fields.push({
        fieldNumber: fieldNumber, wireType: wireType, keyStart: keyStart,
        valueStart: valueStart, valueEnd: valueEnd, end: valueEnd,
        raw: bytes.slice(keyStart, valueEnd), valueBytes: bytes.slice(valueStart, valueEnd)
      });
      offset = valueEnd;
    }
    return fields;
  }

  function isCellResponseField(fieldNumber) { return CELL_RESPONSE_FIELDS[fieldNumber] === true; }

  function coordToInt(value) { return Math.trunc(Number(value) * 100000000); }

  function parseBoolean(value, defaultValue) {
    if (value === true || value === false) return value;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    }
    return defaultValue;
  }

  function normalizeConfig(input) {
    var cfg = {}, key;
    for (key in DEFAULT_CONFIG) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) cfg[key] = DEFAULT_CONFIG[key];
    }
    input = input || {};
    for (key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) cfg[key] = input[key];
    }
    cfg.enabled = parseBoolean(cfg.enabled, true);
    cfg.failOpen = parseBoolean(cfg.failOpen, true);
    cfg.latitude = Number(cfg.latitude);
    cfg.longitude = Number(cfg.longitude);
    return cfg;
  }

  function patchLocation(locationPayload, config) {
    var parts = [], fields = locationPayload.length ? parseFields(locationPayload) : [];
    for (var i = 0; i < fields.length; i += 1) {
      if (!LOCATION_REPLACED_FIELDS[fields[i].fieldNumber]) parts.push(fields[i].raw);
    }
    parts.push(makeVarintField(1, coordToInt(config.latitude)));
    parts.push(makeVarintField(2, coordToInt(config.longitude)));
    parts.push(makeVarintField(3, config.horizontalAccuracy));
    parts.push(makeVarintField(4, config.unknownValue4));
    parts.push(makeVarintField(5, config.altitude));
    parts.push(makeVarintField(6, config.verticalAccuracy));
    parts.push(makeVarintField(11, config.motionActivityType));
    parts.push(makeVarintField(12, config.motionActivityConfidence));
    return concatBytes(parts);
  }

  function patchWifiDevice(wifiPayload, config) {
    var fields = parseFields(wifiPayload), parts = [], patchedLocation = false;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 2 && field.wireType === 2) {
        parts.push(makeLengthDelimitedField(2, patchLocation(field.valueBytes, config)));
        patchedLocation = true;
      } else {
        parts.push(field.raw);
      }
    }
    if (!patchedLocation) parts.push(makeLengthDelimitedField(2, patchLocation(bytesFromArray([]), config)));
    return concatBytes(parts);
  }

  function patchCellTower(cellPayload, config) {
    var fields = parseFields(cellPayload), parts = [], patchedLocation = false;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 5 && field.wireType === 2) {
        parts.push(makeLengthDelimitedField(5, patchLocation(field.valueBytes, config)));
        patchedLocation = true;
      } else {
        parts.push(field.raw);
      }
    }
    if (!patchedLocation) parts.push(makeLengthDelimitedField(2, patchLocation(bytesFromArray([]), config)));
    return concatBytes(parts);
  }

  function patchAppleWLocPayload(payload, config) {
    var fields = parseFields(payload), parts = [], wifiCount = 0, cellCount = 0;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 2 && field.wireType === 2) {
        parts.push(makeLengthDelimitedField(2, patchWifiDevice(field.valueBytes, config)));
        wifiCount += 1;
      } else if (isCellResponseField(field.fieldNumber) && field.wireType === 2) {
        parts.push(makeLengthDelimitedField(field.fieldNumber, patchCellTower(field.valueBytes, config)));
        cellCount += 1;
      } else if (!ROOT_DROP_FIELDS[field.fieldNumber]) {
        parts.push(field.raw);
      }
    }
    return { payload: concatBytes(parts), wifiCount: wifiCount, cellCount: cellCount };
  }

  function readPascalString(bytes, state) {
    var length = readUInt16BE(bytes, state.offset);
    state.offset += 2;
    if (state.offset + length > bytes.length) throw new Error("ARPC pascal string exceeds buffer");
    var chars = [];
    for (var i = 0; i < length; i += 1) chars.push(String.fromCharCode(bytes[state.offset + i]));
    state.offset += length;
    return chars.join("");
  }

  function writePascalString(value) {
    var bytes = asciiBytes(value);
    return concatBytes([writeUInt16BE(bytes.length), bytes]);
  }

  function parseArpc(bytes) {
    var state = { offset: 0 };
    var version = readUInt16BE(bytes, state.offset); state.offset += 2;
    var locale = readPascalString(bytes, state);
    var appIdentifier = readPascalString(bytes, state);
    var osVersion = readPascalString(bytes, state);
    var functionId = readUInt32BE(bytes, state.offset); state.offset += 4;
    var payloadLength = readUInt32BE(bytes, state.offset); state.offset += 4;
    if (state.offset + payloadLength > bytes.length) throw new Error("ARPC payload exceeds buffer");
    return {
      version: version, locale: locale, appIdentifier: appIdentifier,
      osVersion: osVersion, functionId: functionId,
      payload: bytes.slice(state.offset, state.offset + payloadLength)
    };
  }

  function serializeArpc(arpc) {
    return concatBytes([
      writeUInt16BE(arpc.version), writePascalString(arpc.locale),
      writePascalString(arpc.appIdentifier), writePascalString(arpc.osVersion),
      writeUInt32BE(arpc.functionId), writeUInt32BE(arpc.payload.length), arpc.payload
    ]);
  }

  function buildAppleWLocResponse(payload, prefix) {
    return concatBytes([prefix || APPLE_WLOC_PREFIX, writeUInt16BE(payload.length), payload]);
  }

  function extractPrefixedAppleWLocPayload(responseBytes) {
    if (!responseBytes || responseBytes.length < 10) return null;
    if (responseBytes[0] !== 0x00 || responseBytes[1] !== 0x01) return null;
    if (responseBytes[6] !== 0x00 || responseBytes[7] !== 0x00) return null;
    var payloadLength = readUInt16BE(responseBytes, 8);
    var payloadOffset = 10;
    if (payloadLength <= 0 || payloadOffset + payloadLength > responseBytes.length) return null;
    var payload = responseBytes.slice(payloadOffset, payloadOffset + payloadLength);
    if (tryParseFields(payload) === null) return null;
    return {
      kind: "synthetic", payload: payload,
      prefix: responseBytes.slice(0, 8),
      suffix: responseBytes.slice(payloadOffset + payloadLength)
    };
  }

  function extractAppleWLocPayload(responseBytes) {
    if (!responseBytes || responseBytes.length < 2) throw new Error("Apple WLoc response too short");
    var prefixed = extractPrefixedAppleWLocPayload(responseBytes);
    if (prefixed) return prefixed;
    try {
      var arpc = parseArpc(responseBytes);
      if (arpc.payload.length > 0 && tryParseFields(arpc.payload) !== null) {
        return { kind: "arpc", payload: arpc.payload, arpc: arpc };
      }
    } catch (e) {}
    var markerIdx = findBytes(responseBytes, APPLE_WLOC_MARKER);
    if (markerIdx >= 0) {
      var lenOffset = markerIdx + APPLE_WLOC_MARKER.length;
      if (lenOffset + 2 <= responseBytes.length) {
        var realLen = readUInt16BE(responseBytes, lenOffset);
        var realPayloadOffset = lenOffset + 2;
        if (realLen > 0 && realPayloadOffset + realLen <= responseBytes.length) {
          var candidatePayload = responseBytes.slice(realPayloadOffset, realPayloadOffset + realLen);
          if (tryParseFields(candidatePayload) !== null) {
            return {
              kind: "marker", payload: candidatePayload,
              prefix: responseBytes.slice(0, markerIdx),
              markerAndLen: responseBytes.slice(markerIdx, realPayloadOffset),
              suffix: responseBytes.slice(realPayloadOffset + realLen)
            };
          }
        }
      }
    }
    if (looksLikeAppleWLocPayload(responseBytes)) {
      return { kind: "bare", payload: responseBytes };
    }
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
    var patched = patchAppleWLocPayload(extraction.payload, config);
    var response;
    if (extraction.kind === "arpc") {
      var arpcOut = {
        version: extraction.arpc.version, locale: extraction.arpc.locale,
        appIdentifier: extraction.arpc.appIdentifier, osVersion: extraction.arpc.osVersion,
        functionId: extraction.arpc.functionId, payload: patched.payload
      };
      response = serializeArpc(arpcOut);
    } else if (extraction.kind === "marker") {
      var newLenBytes = writeUInt16BE(patched.payload.length);
      response = concatBytes([
        extraction.prefix, extraction.markerAndLen.slice(0, APPLE_WLOC_MARKER.length),
        newLenBytes, patched.payload, extraction.suffix
      ]);
    } else {
      response = buildAppleWLocResponse(patched.payload, extraction.prefix);
    }
    return { response: response };
  }

  function headersWithBinaryBody(sourceHeaders, length) {
    var headers = {}, key;
    sourceHeaders = sourceHeaders || {};
    for (key in sourceHeaders) {
      if (Object.prototype.hasOwnProperty.call(sourceHeaders, key)) {
        var lower = key.toLowerCase();
        if (lower !== "content-length" && lower !== "content-encoding" && lower !== "transfer-encoding") {
          headers[key] = sourceHeaders[key];
        }
      }
    }
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Length"] = String(length);
    return headers;
  }

  function donePassThrough() { $done({}); }

  function doneRewriteResponse(bytes) {
    var sourceHeaders = typeof $response !== "undefined" ? $response.headers : {};
    var headers = headersWithBinaryBody(sourceHeaders, bytes.length);
    if (typeof $loon !== "undefined") {
      $done({ status: ($response && $response.status) || 200, headers: headers, body: bytes });
      return;
    }
    $done({ headers: headers, body: bytes });
  }

  function runShadowrocket() {
    if (typeof $response === "undefined" || !$response) {
      donePassThrough();
      return;
    }

    try {
      var currentLoc = getDynamicLocation();

      var responseBody = messageBodyToBytes($response);
      if (!responseBody || responseBody.length < 2) {
        donePassThrough();
        return;
      }

      var responseResult = spoofAppleResponse(responseBody, {
        latitude: currentLoc.lat,
        longitude: currentLoc.lng
      });

      // Chỉ lưu phiên và thông báo sau khi dữ liệu đã được patch thành công.
      // Nếu patch lỗi, catch sẽ pass-through và phiên vẫn ở trạng thái chờ,
      // để request hợp lệ tiếp theo tiếp tục thử và có thể thông báo.
      if (currentLoc.isNew) {
  commitNewLocation(currentLoc);
}

notifyNewLocation(currentLoc);

doneRewriteResponse(responseResult.response);
    } catch (err) {
      donePassThrough();
    }
  }

  function run() {
    // Khi file được gọi bằng event script network-changed, đánh dấu phiên cũ
    // đã kết thúc. Request định vị tiếp theo sẽ tạo một tọa độ mới.
    if (typeof $event !== "undefined") {
      endLocationSession();
      $done();
      return;
    }

    runShadowrocket();
  }

  run();
})();
