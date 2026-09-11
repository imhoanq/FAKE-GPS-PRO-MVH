/*
 * Fake GPS Shadowrocket
 *
 * - Mỗi phiên VPN giữ nguyên một tọa độ.
 * - Mỗi lần bật lại VPN chọn điểm mới.
 * - 20 điểm được dùng lần lượt theo thứ tự ngẫu nhiên, không lặp trong một vòng.
 * - Thông báo sau khi sửa GPS thành công.
 * - Cảnh báo nếu vị trí thay đổi đột ngột.
 */

(function () {
  "use strict";

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

  var CAFE_NAME = "Cà Phê Muối Chú Long";
  var DEFAULT_LAT = 16.0664334;
  var DEFAULT_LNG = 108.2067245;

  var STORE_LAT_KEY = "SESSION_FAKE_LAT";
  var STORE_LNG_KEY = "SESSION_FAKE_LNG";
  var STORE_ACTIVE_KEY = "SESSION_FAKE_ACTIVE";

  var STORE_NOTIFY_KEY =
    "SESSION_FAKE_LAST_NOTIFIED_LOCATION_V5";

  var STORE_LOCATION_QUEUE_KEY =
    "SESSION_FAKE_LOCATION_QUEUE_V5";

  var STORE_LAST_LOCATION_INDEX_KEY =
    "SESSION_FAKE_LAST_LOCATION_INDEX_V5";

  var MIN_NEW_LOCATION_DISTANCE_METERS = 1;

  function readStoredValue(key, fallback) {
    if (typeof $persistentStore === "undefined") {
      return fallback;
    }

    var value = $persistentStore.read(key);

    return value == null || value === ""
      ? fallback
      : value;
  }

  function writeStoredValue(value, key) {
    if (typeof $persistentStore !== "undefined") {
      $persistentStore.write(String(value), key);
    }
  }

  function pickRandomBaseLocation() {
    var queue = [];
    var savedQueue = readStoredValue(
      STORE_LOCATION_QUEUE_KEY,
      ""
    );

    try {
      queue = JSON.parse(savedQueue);
    } catch (error) {
      queue = [];
    }

    if (!Array.isArray(queue) || queue.length === 0) {
      queue = [];

      for (
        var i = 0;
        i < RANDOM_LOCATIONS.length;
        i += 1
      ) {
        queue.push(i);
      }

      for (
        var j = queue.length - 1;
        j > 0;
        j -= 1
      ) {
        var randomIndex = Math.floor(
          Math.random() * (j + 1)
        );

        var temporaryIndex = queue[j];

        queue[j] = queue[randomIndex];
        queue[randomIndex] = temporaryIndex;
      }

      var lastIndex = parseInt(
        readStoredValue(
          STORE_LAST_LOCATION_INDEX_KEY,
          "-1"
        ),
        10
      );

      if (
        queue.length > 1 &&
        queue[0] === lastIndex
      ) {
        var swapIndex = queue[0];

        queue[0] = queue[1];
        queue[1] = swapIndex;
      }
    }

    var selectedIndex = queue.shift();

    writeStoredValue(
      JSON.stringify(queue),
      STORE_LOCATION_QUEUE_KEY
    );

    writeStoredValue(
      String(selectedIndex),
      STORE_LAST_LOCATION_INDEX_KEY
    );

    return RANDOM_LOCATIONS[selectedIndex];
  }

  function distanceMetersExact(
    lat1,
    lng1,
    lat2,
    lng2
  ) {
    var earthRadius = 6371000;
    var toRadians = Math.PI / 180;

    var latitudeDifference =
      (lat2 - lat1) * toRadians;

    var longitudeDifference =
      (lng2 - lng1) * toRadians;

    var calculation =
      Math.sin(latitudeDifference / 2) *
        Math.sin(latitudeDifference / 2) +
      Math.cos(lat1 * toRadians) *
        Math.cos(lat2 * toRadians) *
        Math.sin(longitudeDifference / 2) *
        Math.sin(longitudeDifference / 2);

    var result =
      2 *
      Math.atan2(
        Math.sqrt(calculation),
        Math.sqrt(1 - calculation)
      );

    return earthRadius * result;
  }

  function distanceMeters(
    lat1,
    lng1,
    lat2,
    lng2
  ) {
    return Math.round(
      distanceMetersExact(
        lat1,
        lng1,
        lat2,
        lng2
      )
    );
  }

  function addJitter(location) {
    var latitudeJitter =
      (Math.random() - 0.5) * 0.000015;

    var longitudeJitter =
      (Math.random() - 0.5) * 0.000015;

    return {
      lat: location.lat + latitudeJitter,
      lng: location.lng + longitudeJitter
    };
  }

  function createNewLocation(
    previousLatitude,
    previousLongitude
  ) {
    var candidate;
    var attempts = 0;

    do {
      candidate = addJitter(
        pickRandomBaseLocation()
      );

      attempts += 1;
    } while (
      attempts < 50 &&
      isFinite(previousLatitude) &&
      isFinite(previousLongitude) &&
      previousLatitude !== 0 &&
      previousLongitude !== 0 &&
      distanceMetersExact(
        previousLatitude,
        previousLongitude,
        candidate.lat,
        candidate.lng
      ) < MIN_NEW_LOCATION_DISTANCE_METERS
    );

    return candidate;
  }

  function getDynamicLocation() {
    var savedLatitude = parseFloat(
      readStoredValue(STORE_LAT_KEY, "0")
    );

    var savedLongitude = parseFloat(
      readStoredValue(STORE_LNG_KEY, "0")
    );

    var sessionActive =
      readStoredValue(
        STORE_ACTIVE_KEY,
        "0"
      ) === "1";

    if (
      sessionActive &&
      isFinite(savedLatitude) &&
      isFinite(savedLongitude) &&
      savedLatitude !== 0 &&
      savedLongitude !== 0
    ) {
      return {
        lat: savedLatitude,
        lng: savedLongitude,
        isNew: false
      };
    }

    var newLocation = createNewLocation(
      savedLatitude,
      savedLongitude
    );

    return {
      lat: newLocation.lat,
      lng: newLocation.lng,
      isNew: true
    };
  }

  function commitNewLocation(location) {
    writeStoredValue(
      location.lat,
      STORE_LAT_KEY
    );

    writeStoredValue(
      location.lng,
      STORE_LNG_KEY
    );

    writeStoredValue(
      "1",
      STORE_ACTIVE_KEY
    );
  }

  function notifyLocation(location) {
    if (
      typeof $notification === "undefined"
    ) {
      return;
    }

    var locationId =
      location.lat.toFixed(7) +
      "," +
      location.lng.toFixed(7);

    var previousLocationId =
      readStoredValue(
        STORE_NOTIFY_KEY,
        ""
      );

    if (previousLocationId === locationId) {
      return;
    }

    var distanceToCafe = distanceMeters(
      DEFAULT_LAT,
      DEFAULT_LNG,
      location.lat,
      location.lng
    );

    var notificationTitle =
      previousLocationId
        ? "⚠️ GPS ĐÃ THAY ĐỔI ĐỘT NGỘT"
        : "📍 FAKE GPS ĐÃ BẬT";

    $notification.post(
      notificationTitle,
      "Cách " +
        CAFE_NAME +
        ": " +
        distanceToCafe +
        " mét",
      "Tọa độ: " +
        location.lat.toFixed(7) +
        ", " +
        location.lng.toFixed(7)
    );

    writeStoredValue(
      locationId,
      STORE_NOTIFY_KEY
    );
  }

  var DEFAULT_CONFIG = {
    enabled: true,
    mode: "response",
    latitude: DEFAULT_LAT,
    longitude: DEFAULT_LNG,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467,
    failOpen: true
  };

  var APPLE_WLOC_PREFIX = bytesFromArray([
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00
  ]);

  var APPLE_WLOC_MARKER = bytesFromArray([
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00
  ]);

  var ROOT_DROP_FIELDS = {
    3: true,
    4: true,
    33: true
  };

  var CELL_RESPONSE_FIELDS = {
    22: true,
    24: true
  };

  var LOCATION_REPLACED_FIELDS = {
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    11: true,
    12: true
  };

  function bytesFromArray(values) {
    return new Uint8Array(values);
  }

  function concatBytes(parts) {
    var totalLength = 0;
    var index;

    for (
      index = 0;
      index < parts.length;
      index += 1
    ) {
      totalLength += parts[index].length;
    }

    var output =
      new Uint8Array(totalLength);

    var offset = 0;

    for (
      index = 0;
      index < parts.length;
      index += 1
    ) {
      output.set(parts[index], offset);
      offset += parts[index].length;
    }

    return output;
  }

  function findBytes(bytes, marker) {
    if (
      !bytes ||
      !marker ||
      marker.length === 0
    ) {
      return -1;
    }

    for (
      var i = 0;
      i <= bytes.length - marker.length;
      i += 1
    ) {
      var found = true;

      for (
        var j = 0;
        j < marker.length;
        j += 1
      ) {
        if (bytes[i + j] !== marker[j]) {
          found = false;
          break;
        }
      }

      if (found) {
        return i;
      }
    }

    return -1;
  }

  function tryParseFields(bytes) {
    try {
      if (!bytes || bytes.length === 0) {
        return null;
      }

      var fields = parseFields(bytes);

      return fields.length > 0
        ? fields
        : null;
    } catch (error) {
      return null;
    }
  }

  function binaryStringToBytes(value) {
    var output =
      new Uint8Array(value.length);

    for (
      var i = 0;
      i < value.length;
      i += 1
    ) {
      output[i] =
        value.charCodeAt(i) & 0xff;
    }

    return output;
  }

  function bodyToBytes(body) {
    if (body == null) {
      return null;
    }

    if (body instanceof Uint8Array) {
      return body;
    }

    if (
      typeof ArrayBuffer !== "undefined" &&
      body instanceof ArrayBuffer
    ) {
      return new Uint8Array(body);
    }

    if (typeof body === "string") {
      return binaryStringToBytes(body);
    }

    if (
      typeof body === "object" &&
      typeof body.length === "number"
    ) {
      return new Uint8Array(body);
    }

    if (
      typeof body === "object" &&
      body.bytes &&
      typeof body.bytes.length === "number"
    ) {
      return new Uint8Array(body.bytes);
    }

    if (
      typeof body === "object" &&
      body.data &&
      typeof body.data.length === "number"
    ) {
      return new Uint8Array(body.data);
    }

    return null;
  }

  function messageBodyToBytes(message) {
    if (!message) {
      return null;
    }

    return (
      bodyToBytes(message.bodyBytes) ||
      bodyToBytes(message.body) ||
      bodyToBytes(message.rawBody) ||
      bodyToBytes(message.binaryBody)
    );
  }

  function readUInt16BE(bytes, offset) {
    if (offset + 2 > bytes.length) {
      throw new Error(
        "uint16 out of range"
      );
    }

    return (
      (bytes[offset] << 8) |
      bytes[offset + 1]
    );
  }

  function readUInt32BE(bytes, offset) {
    if (offset + 4 > bytes.length) {
      throw new Error(
        "uint32 out of range"
      );
    }

    return (
      bytes[offset] * 0x1000000 +
      ((bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3])
    ) >>> 0;
  }

  function writeUInt16BE(value) {
    if (
      value < 0 ||
      value > 0xffff
    ) {
      throw new Error(
        "uint16 value out of range: " +
          value
      );
    }

    return bytesFromArray([
      (value >> 8) & 0xff,
      value & 0xff
    ]);
  }

  function writeUInt32BE(value) {
    return bytesFromArray([
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff
    ]);
  }

  function asciiBytes(value) {
    var output =
      new Uint8Array(value.length);

    for (
      var i = 0;
      i < value.length;
      i += 1
    ) {
      output[i] =
        value.charCodeAt(i) & 0x7f;
    }

    return output;
  }

  function encodeVarintUnsigned(value) {
    var bigintValue =
      typeof value === "bigint"
        ? value
        : BigInt(value);

    if (bigintValue < 0n) {
      throw new Error(
        "negative unsigned varint"
      );
    }

    var output = [];

    while (bigintValue >= 0x80n) {
      output.push(
        Number(
          (bigintValue & 0x7fn) |
            0x80n
        )
      );

      bigintValue >>= 7n;
    }

    output.push(Number(bigintValue));

    return bytesFromArray(output);
  }

  function encodeVarintSignedInt64(value) {
    var bigintValue =
      typeof value === "bigint"
        ? value
        : BigInt(Math.trunc(value));

    if (bigintValue < 0n) {
      bigintValue =
        BigInt.asUintN(
          64,
          bigintValue
        );
    }

    return encodeVarintUnsigned(
      bigintValue
    );
  }

  function decodeVarint(bytes, offset) {
    var result = 0n;
    var shift = 0n;
    var currentOffset = offset;

    while (
      currentOffset < bytes.length
    ) {
      var byteValue =
        bytes[currentOffset];

      currentOffset += 1;

      result |=
        BigInt(byteValue & 0x7f) <<
        shift;

      if ((byteValue & 0x80) === 0) {
        return {
          value: result,
          offset: currentOffset
        };
      }

      shift += 7n;

      if (shift > 70n) {
        throw new Error(
          "varint too long"
        );
      }
    }

    throw new Error(
      "unterminated varint"
    );
  }

  function makeKey(
    fieldNumber,
    wireType
  ) {
    return encodeVarintUnsigned(
      (BigInt(fieldNumber) << 3n) |
        BigInt(wireType)
    );
  }

  function makeVarintField(
    fieldNumber,
    value
  ) {
    return concatBytes([
      makeKey(fieldNumber, 0),
      encodeVarintSignedInt64(value)
    ]);
  }

  function makeLengthDelimitedField(
    fieldNumber,
    payload
  ) {
    return concatBytes([
      makeKey(fieldNumber, 2),
      encodeVarintUnsigned(
        payload.length
      ),
      payload
    ]);
  }

  function parseFields(bytes) {
    var fields = [];
    var offset = 0;

    while (offset < bytes.length) {
      var keyStart = offset;
      var key = decodeVarint(
        bytes,
        offset
      );

      offset = key.offset;

      var fieldNumber = Number(
        key.value >> 3n
      );

      var wireType = Number(
        key.value & 0x7n
      );

      if (fieldNumber === 0) {
        throw new Error(
          "protobuf field number 0"
        );
      }

      var valueStart = offset;
      var valueEnd;

      if (wireType === 0) {
        valueEnd = decodeVarint(
          bytes,
          offset
        ).offset;
      } else if (wireType === 1) {
        valueEnd = offset + 8;
      } else if (wireType === 2) {
        var lengthInformation =
          decodeVarint(
            bytes,
            offset
          );

        var length = Number(
          lengthInformation.value
        );

        valueStart =
          lengthInformation.offset;

        valueEnd =
          valueStart + length;
      } else if (wireType === 5) {
        valueEnd = offset + 4;
      } else {
        throw new Error(
          "unsupported protobuf wire type: " +
            wireType
        );
      }

      if (valueEnd > bytes.length) {
        throw new Error(
          "protobuf field exceeds buffer"
        );
      }

      fields.push({
        fieldNumber: fieldNumber,
        wireType: wireType,
        keyStart: keyStart,
        valueStart: valueStart,
        valueEnd: valueEnd,
        end: valueEnd,
        raw: bytes.slice(
          keyStart,
          valueEnd
        ),
        valueBytes: bytes.slice(
          valueStart,
          valueEnd
        )
      });

      offset = valueEnd;
    }

    return fields;
  }

  function isCellResponseField(
    fieldNumber
  ) {
    return (
      CELL_RESPONSE_FIELDS[
        fieldNumber
      ] === true
    );
  }

  function coordToInt(value) {
    return Math.trunc(
      Number(value) * 100000000
    );
  }

  function normalizeConfig(input) {
    var config = {};
    var key;

    for (key in DEFAULT_CONFIG) {
      if (
        Object.prototype.hasOwnProperty.call(
          DEFAULT_CONFIG,
          key
        )
      ) {
        config[key] =
          DEFAULT_CONFIG[key];
      }
    }

    input = input || {};

    for (key in input) {
      if (
        Object.prototype.hasOwnProperty.call(
          input,
          key
        )
      ) {
        config[key] = input[key];
      }
    }

    config.latitude =
      Number(config.latitude);

    config.longitude =
      Number(config.longitude);

    return config;
  }

  function patchLocation(
    locationPayload,
    config
  ) {
    var parts = [];

    var fields =
      locationPayload.length
        ? parseFields(locationPayload)
        : [];

    for (
      var i = 0;
      i < fields.length;
      i += 1
    ) {
      if (
        !LOCATION_REPLACED_FIELDS[
          fields[i].fieldNumber
        ]
      ) {
        parts.push(fields[i].raw);
      }
    }

    parts.push(
      makeVarintField(
        1,
        coordToInt(config.latitude)
      )
    );

    parts.push(
      makeVarintField(
        2,
        coordToInt(config.longitude)
      )
    );

    parts.push(
      makeVarintField(
        3,
        config.horizontalAccuracy
      )
    );

    parts.push(
      makeVarintField(
        4,
        config.unknownValue4
      )
    );

    parts.push(
      makeVarintField(
        5,
        config.altitude
      )
    );

    parts.push(
      makeVarintField(
        6,
        config.verticalAccuracy
      )
    );

    parts.push(
      makeVarintField(
        11,
        config.motionActivityType
      )
    );

    parts.push(
      makeVarintField(
        12,
        config.motionActivityConfidence
      )
    );

    return concatBytes(parts);
  }

  function patchWifiDevice(
    wifiPayload,
    config
  ) {
    var fields =
      parseFields(wifiPayload);

    var parts = [];
    var patchedLocation = false;

    for (
      var i = 0;
      i < fields.length;
      i += 1
    ) {
      var field = fields[i];

      if (
        field.fieldNumber === 2 &&
        field.wireType === 2
      ) {
        parts.push(
          makeLengthDelimitedField(
            2,
            patchLocation(
              field.valueBytes,
              config
            )
          )
        );

        patchedLocation = true;
      } else {
        parts.push(field.raw);
      }
    }

    if (!patchedLocation) {
      parts.push(
        makeLengthDelimitedField(
          2,
          patchLocation(
            bytesFromArray([]),
            config
          )
        )
      );
    }

    return concatBytes(parts);
  }

  function patchCellTower(
    cellPayload,
    config
  ) {
    var fields =
      parseFields(cellPayload);

    var parts = [];
    var patchedLocation = false;

    for (
      var i = 0;
      i < fields.length;
      i += 1
    ) {
      var field = fields[i];

      if (
        field.fieldNumber === 5 &&
        field.wireType === 2
      ) {
        parts.push(
          makeLengthDelimitedField(
            5,
            patchLocation(
              field.valueBytes,
              config
            )
          )
        );

        patchedLocation = true;
      } else {
        parts.push(field.raw);
      }
    }

    if (!patchedLocation) {
      parts.push(
        makeLengthDelimitedField(
          2,
          patchLocation(
            bytesFromArray([]),
            config
          )
        )
      );
    }

    return concatBytes(parts);
  }

  function patchAppleWLocPayload(
    payload,
    config
  ) {
    var fields = parseFields(payload);
    var parts = [];

    for (
      var i = 0;
      i < fields.length;
      i += 1
    ) {
      var field = fields[i];

      if (
        field.fieldNumber === 2 &&
        field.wireType === 2
      ) {
        parts.push(
          makeLengthDelimitedField(
            2,
            patchWifiDevice(
              field.valueBytes,
              config
            )
          )
        );
      } else if (
        isCellResponseField(
          field.fieldNumber
        ) &&
        field.wireType === 2
      ) {
        parts.push(
          makeLengthDelimitedField(
            field.fieldNumber,
            patchCellTower(
              field.valueBytes,
              config
            )
          )
        );
      } else if (
        !ROOT_DROP_FIELDS[
          field.fieldNumber
        ]
      ) {
        parts.push(field.raw);
      }
    }

    return concatBytes(parts);
  }

  function readPascalString(
    bytes,
    state
  ) {
    var length = readUInt16BE(
      bytes,
      state.offset
    );

    state.offset += 2;

    if (
      state.offset + length >
      bytes.length
    ) {
      throw new Error(
        "ARPC pascal string exceeds buffer"
      );
    }

    var characters = [];

    for (
      var i = 0;
      i < length;
      i += 1
    ) {
      characters.push(
        String.fromCharCode(
          bytes[state.offset + i]
        )
      );
    }

    state.offset += length;

    return characters.join("");
  }

  function writePascalString(value) {
    var bytes = asciiBytes(value);

    return concatBytes([
      writeUInt16BE(bytes.length),
      bytes
    ]);
  }

  function parseArpc(bytes) {
    var state = { offset: 0 };

    var version = readUInt16BE(
      bytes,
      state.offset
    );

    state.offset += 2;

    var locale =
      readPascalString(bytes, state);

    var appIdentifier =
      readPascalString(bytes, state);

    var osVersion =
      readPascalString(bytes, state);

    var functionId = readUInt32BE(
      bytes,
      state.offset
    );

    state.offset += 4;

    var payloadLength = readUInt32BE(
      bytes,
      state.offset
    );

    state.offset += 4;

    if (
      state.offset + payloadLength >
      bytes.length
    ) {
      throw new Error(
        "ARPC payload exceeds buffer"
      );
    }

    return {
      version: version,
      locale: locale,
      appIdentifier: appIdentifier,
      osVersion: osVersion,
      functionId: functionId,
      payload: bytes.slice(
        state.offset,
        state.offset + payloadLength
      )
    };
  }

  function serializeArpc(arpc) {
    return concatBytes([
      writeUInt16BE(arpc.version),
      writePascalString(arpc.locale),
      writePascalString(
        arpc.appIdentifier
      ),
      writePascalString(
        arpc.osVersion
      ),
      writeUInt32BE(arpc.functionId),
      writeUInt32BE(
        arpc.payload.length
      ),
      arpc.payload
    ]);
  }

  function buildAppleWLocResponse(
    payload,
    prefix
  ) {
    return concatBytes([
      prefix || APPLE_WLOC_PREFIX,
      writeUInt16BE(payload.length),
      payload
    ]);
  }

  function extractPrefixedAppleWLocPayload(
    responseBytes
  ) {
    if (
      !responseBytes ||
      responseBytes.length < 10
    ) {
      return null;
    }

    if (
      responseBytes[0] !== 0x00 ||
      responseBytes[1] !== 0x01
    ) {
      return null;
    }

    if (
      responseBytes[6] !== 0x00 ||
      responseBytes[7] !== 0x00
    ) {
      return null;
    }

    var payloadLength = readUInt16BE(
      responseBytes,
      8
    );

    var payloadOffset = 10;

    if (
      payloadLength <= 0 ||
      payloadOffset + payloadLength >
        responseBytes.length
    ) {
      return null;
    }

    var payload = responseBytes.slice(
      payloadOffset,
      payloadOffset + payloadLength
    );

    if (tryParseFields(payload) === null) {
      return null;
    }

    return {
      kind: "synthetic",
      payload: payload,
      prefix: responseBytes.slice(0, 8),
      suffix: responseBytes.slice(
        payloadOffset + payloadLength
      )
    };
  }

  function looksLikeAppleWLocPayload(
    bytes
  ) {
    if (!bytes || bytes.length === 0) {
      return false;
    }

    var tag = bytes[0];
    var fieldNumber = tag >> 3;
    var wireType = tag & 0x7;

    return (
      fieldNumber > 0 &&
      (wireType === 0 ||
        wireType === 2)
    );
  }

  function extractAppleWLocPayload(
    responseBytes
  ) {
    if (
      !responseBytes ||
      responseBytes.length < 2
    ) {
      throw new Error(
        "Apple WLoc response too short"
      );
    }

    var prefixed =
      extractPrefixedAppleWLocPayload(
        responseBytes
      );

    if (prefixed) {
      return prefixed;
    }

    try {
      var arpc =
        parseArpc(responseBytes);

      if (
        arpc.payload.length > 0 &&
        tryParseFields(
          arpc.payload
        ) !== null
      ) {
        return {
          kind: "arpc",
          payload: arpc.payload,
          arpc: arpc
        };
      }
    } catch (error) {}

    var markerIndex = findBytes(
      responseBytes,
      APPLE_WLOC_MARKER
    );

    if (markerIndex >= 0) {
      var lengthOffset =
        markerIndex +
        APPLE_WLOC_MARKER.length;

      if (
        lengthOffset + 2 <=
        responseBytes.length
      ) {
        var realLength =
          readUInt16BE(
            responseBytes,
            lengthOffset
          );

        var realPayloadOffset =
          lengthOffset + 2;

        if (
          realLength > 0 &&
          realPayloadOffset +
            realLength <=
            responseBytes.length
        ) {
          var candidatePayload =
            responseBytes.slice(
              realPayloadOffset,
              realPayloadOffset +
                realLength
            );

          if (
            tryParseFields(
              candidatePayload
            ) !== null
          ) {
            return {
              kind: "marker",
              payload:
                candidatePayload,
              prefix:
                responseBytes.slice(
                  0,
                  markerIndex
                ),
              markerAndLength:
                responseBytes.slice(
                  markerIndex,
                  realPayloadOffset
                ),
              suffix:
                responseBytes.slice(
                  realPayloadOffset +
                    realLength
                )
            };
          }
        }
      }
    }

    if (
      looksLikeAppleWLocPayload(
        responseBytes
      )
    ) {
      return {
        kind: "bare",
        payload: responseBytes
      };
    }

    throw new Error(
      "missing Apple WLoc response prefix"
    );
  }

  function spoofAppleResponse(
    responseBytes,
    configInput
  ) {
    var config =
      normalizeConfig(configInput);

    var extraction =
      extractAppleWLocPayload(
        responseBytes
      );

    var patchedPayload =
      patchAppleWLocPayload(
        extraction.payload,
        config
      );

    var response;

    if (extraction.kind === "arpc") {
      response = serializeArpc({
        version:
          extraction.arpc.version,
        locale:
          extraction.arpc.locale,
        appIdentifier:
          extraction.arpc
            .appIdentifier,
        osVersion:
          extraction.arpc.osVersion,
        functionId:
          extraction.arpc.functionId,
        payload: patchedPayload
      });
    } else if (
      extraction.kind === "marker"
    ) {
      var newLengthBytes =
        writeUInt16BE(
          patchedPayload.length
        );

      response = concatBytes([
        extraction.prefix,
        extraction.markerAndLength.slice(
          0,
          APPLE_WLOC_MARKER.length
        ),
        newLengthBytes,
        patchedPayload,
        extraction.suffix
      ]);
    } else {
      response =
        buildAppleWLocResponse(
          patchedPayload,
          extraction.prefix
        );
    }

    return response;
  }

  function headersWithBinaryBody(
    sourceHeaders,
    length
  ) {
    var headers = {};
    var key;

    sourceHeaders =
      sourceHeaders || {};

    for (key in sourceHeaders) {
      if (
        Object.prototype.hasOwnProperty.call(
          sourceHeaders,
          key
        )
      ) {
        var lowercaseKey =
          key.toLowerCase();

        if (
          lowercaseKey !==
            "content-length" &&
          lowercaseKey !==
            "content-encoding" &&
          lowercaseKey !==
            "transfer-encoding"
        ) {
          headers[key] =
            sourceHeaders[key];
        }
      }
    }

    headers["Content-Type"] =
      "application/octet-stream";

    headers["Content-Length"] =
      String(length);

    return headers;
  }

  function finishPassThrough() {
    $done({});
  }

  function finishRewrite(bytes) {
    var sourceHeaders =
      typeof $response !== "undefined"
        ? $response.headers
        : {};

    var headers =
      headersWithBinaryBody(
        sourceHeaders,
        bytes.length
      );

    $done({
      headers: headers,
      body: bytes
    });
  }

  function run() {
    if (
      typeof $response === "undefined" ||
      !$response
    ) {
      finishPassThrough();
      return;
    }

    try {
      var currentLocation =
        getDynamicLocation();

      var responseBody =
        messageBodyToBytes($response);

      if (
        !responseBody ||
        responseBody.length < 2
      ) {
        finishPassThrough();
        return;
      }

      var rewrittenResponse =
        spoofAppleResponse(
          responseBody,
          {
            latitude:
              currentLocation.lat,

            longitude:
              currentLocation.lng,

            horizontalAccuracy: 39,
            verticalAccuracy: 1000,
            altitude: 530
          }
        );

      if (currentLocation.isNew) {
        commitNewLocation(
          currentLocation
        );
      }

      notifyLocation(currentLocation);

      finishRewrite(
        rewrittenResponse
      );
    } catch (error) {
      finishPassThrough();
    }
  }

  run();
})();
