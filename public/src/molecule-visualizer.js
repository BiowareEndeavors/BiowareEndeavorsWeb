(function () {
  if (typeof window === "undefined") return;

  var lastVolumeMode = typeof renderMode === "string" && renderMode === "volume" ? "volume" : "iso";
  var pendingBallstickSelection = "";
  var currentVizSelection = typeof renderMode === "string" && renderMode === "volume" ? "volume" : "iso";
  var vizUiBound = false;

  var moleculeShader = null;
  var moleculeAtomMesh = null;
  var moleculeBondMesh = null;
  var moleculeForceShaftMesh = null;
  var moleculeForceHeadMesh = null;

  var moleculeState = {
    scene: null,
    sourceKey: "",
    frameIndex: 0,
    playing: false,
    lastAdvanceAt: 0,
    newUpload: false,
  };
  var defaultBallstickScene = null;
  var defaultBallstickScenePromise = null;
  var DEFAULT_BALLSTICK_XML_URL = "/assets/Caffeine.xml";
  var ANGSTROM_TO_BOHR = 1.8897259886;
  var BALLSTICK_ATOM_SCALE = 0.5;
  var BALLSTICK_BOND_RADIUS = 0.05;
  var MIN_ATOM_RADIUS = 0.15 * ANGSTROM_TO_BOHR;
  var MAX_ATOM_RADIUS = 2.5 * ANGSTROM_TO_BOHR;
  var MIN_BOND_CUTOFF = 0.45 * ANGSTROM_TO_BOHR;
  var DEFAULT_FIT_MIN_DISTANCE = 2.75;
  var DEFAULT_FIT_DISTANCE_MULTIPLIER = 1.45;
  var DEFAULT_FIT_MIN_ORBIT_RADIUS = 0.9;
  var DEFAULT_FIT_ORBIT_RADIUS_MULTIPLIER = 0.85;
  var FORCE_ARROW_COLOR = [0.0, 0.9, 0.75];
  var FORCE_ARROW_MAX_LENGTH_RATIO = 0.38;
  var FORCE_ARROW_SHAFT_RADIUS_RATIO = 0.012;
  var FORCE_ARROW_HEAD_RADIUS_RATIO = 0.038;
  var FORCE_ARROW_HEAD_LENGTH_RATIO = 0.095;
  var volumeCamera = null;
  var moleculeCamera = null;

  uiState.playback_fps = 12;
  uiState.show_forces = false;

  var vertShaderMesh =
    "#version 300 es\n" +
    "layout(location=0) in vec3 pos;\n" +
    "layout(location=1) in vec3 normal;\n" +
    "layout(location=2) in vec4 iModelCol0;\n" +
    "layout(location=3) in vec4 iModelCol1;\n" +
    "layout(location=4) in vec4 iModelCol2;\n" +
    "layout(location=5) in vec4 iModelCol3;\n" +
    "layout(location=6) in vec3 iColor;\n" +
    "\n" +
    "uniform mat4 proj_view;\n" +
    "\n" +
    "out vec3 vColor;\n" +
    "out vec3 vNormal;\n" +
    "out vec3 vWorldPos;\n" +
    "\n" +
    "void main(void) {\n" +
    "    mat4 model = mat4(iModelCol0, iModelCol1, iModelCol2, iModelCol3);\n" +
    "    vec4 worldPos = model * vec4(pos, 1.0);\n" +
    "    mat3 normalMat = mat3(transpose(inverse(model)));\n" +
    "    vColor = iColor;\n" +
    "    vWorldPos = worldPos.xyz;\n" +
    "    vNormal = normalize(normalMat * normal);\n" +
    "    gl_Position = proj_view * worldPos;\n" +
    "}";

  var fragShaderMesh =
    "#version 300 es\n" +
    "precision highp float;\n" +
    "\n" +
    "uniform vec3 eye_pos;\n" +
    "\n" +
    "in vec3 vColor;\n" +
    "in vec3 vNormal;\n" +
    "in vec3 vWorldPos;\n" +
    "out vec4 color;\n" +
    "\n" +
    "float linear_to_srgb(float x) {\n" +
    "    if (x <= 0.0031308) return 12.92 * x;\n" +
    "    return 1.055 * pow(x, 1.0 / 2.4) - 0.055;\n" +
    "}\n" +
    "\n" +
    "void main(void) {\n" +
    "    vec3 N = normalize(vNormal);\n" +
    "    vec3 V = normalize(eye_pos - vWorldPos);\n" +
    "    vec3 L = normalize(V + vec3(0.15, 0.35, 0.25));\n" +
    "    vec3 H = normalize(L + V);\n" +
    "\n" +
    "    float diff = max(dot(N, L), 0.0);\n" +
    "    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);\n" +
    "    float spec = pow(max(dot(N, H), 0.0), 42.0);\n" +
    "\n" +
    "    vec3 shaded = vColor * (0.26 + 0.86 * diff) + vec3(1.0) * (0.22 * spec + 0.06 * rim);\n" +
    "\n" +
    "    color = vec4(\n" +
    "        linear_to_srgb(shaded.r),\n" +
    "        linear_to_srgb(shaded.g),\n" +
    "        linear_to_srgb(shaded.b),\n" +
    "        1.0\n" +
    "    );\n" +
    "}";

  function toBohrDistance(value) {
    return value * ANGSTROM_TO_BOHR;
  }

  var ELEMENT_VISUALS = {
    1: { color: [0.94, 0.94, 0.94], radius: toBohrDistance(0.31) },
    5: { color: [1.0, 0.71, 0.71], radius: toBohrDistance(0.84) },
    6: { color: [0.22, 0.22, 0.24], radius: toBohrDistance(0.76) },
    7: { color: [0.19, 0.31, 0.97], radius: toBohrDistance(0.71) },
    8: { color: [0.92, 0.18, 0.18], radius: toBohrDistance(0.66) },
    9: { color: [0.56, 0.88, 0.31], radius: toBohrDistance(0.57) },
    14: { color: [0.95, 0.78, 0.47], radius: toBohrDistance(1.11) },
    15: { color: [1.0, 0.5, 0.0], radius: toBohrDistance(1.07) },
    16: { color: [0.95, 0.9, 0.2], radius: toBohrDistance(1.05) },
    17: { color: [0.12, 0.94, 0.12], radius: toBohrDistance(1.02) },
    35: { color: [0.65, 0.16, 0.16], radius: toBohrDistance(1.2) },
    53: { color: [0.58, 0.0, 0.58], radius: toBohrDistance(1.39) },
  };
  var ELEMENT_INFO = {
    1: { symbol: "H", name: "Hydrogen" },
    5: { symbol: "B", name: "Boron" },
    6: { symbol: "C", name: "Carbon" },
    7: { symbol: "N", name: "Nitrogen" },
    8: { symbol: "O", name: "Oxygen" },
    9: { symbol: "F", name: "Fluorine" },
    14: { symbol: "Si", name: "Silicon" },
    15: { symbol: "P", name: "Phosphorus" },
    16: { symbol: "S", name: "Sulfur" },
    17: { symbol: "Cl", name: "Chlorine" },
    35: { symbol: "Br", name: "Bromine" },
    53: { symbol: "I", name: "Iodine" },
  };

  function getElementVisual(atomicNumber) {
    return ELEMENT_VISUALS[atomicNumber] || {
      color: [0.62, 0.72, 0.82],
      radius: toBohrDistance(0.9),
    };
  }

  function clampNumber(value, min, max, fallback) {
    var num = Number(value);
    if (!isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
  }

  function toCssRgb(color) {
    return "rgb(" +
      Math.round(clampNumber(color[0], 0, 1, 0) * 255) + ", " +
      Math.round(clampNumber(color[1], 0, 1, 0) * 255) + ", " +
      Math.round(clampNumber(color[2], 0, 1, 0) * 255) + ")";
  }

  function getElementLabel(atomicNumber) {
    var info = ELEMENT_INFO[atomicNumber];
    if (!info) return "Z=" + atomicNumber;
    return info.symbol + " " + info.name;
  }

  function parseHexColor(hex) {
    if (typeof hex !== "string") return null;
    var cleaned = hex.trim();
    if (!/^#([0-9a-f]{6})$/i.test(cleaned)) return null;
    var value = parseInt(cleaned.slice(1), 16);
    return [
      ((value >> 16) & 255) / 255.0,
      ((value >> 8) & 255) / 255.0,
      (value & 255) / 255.0,
    ];
  }

  function toFiniteArray(raw) {
    if (!raw) return [];
    if (ArrayBuffer.isView(raw)) return Array.from(raw);
    return Array.isArray(raw) ? raw.slice() : [];
  }

  function normalizeAtomicNumbers(input) {
    var values = input.atomicNumbers || input.atomic_numbers || input.elements || input.z;
    if ((!values || !values.length) && Array.isArray(input.atoms)) {
      values = input.atoms.map(function (atom) {
        return atom.atomicNumber ?? atom.atomic_number ?? atom.Z ?? atom.element ?? atom.number;
      });
    }

    return toFiniteArray(values)
      .map(function (value) {
        return Math.max(1, Math.trunc(Number(value) || 0));
      })
      .filter(function (value) {
        return value > 0;
      });
  }

  function flattenAtomPositions(atoms) {
    if (!Array.isArray(atoms)) return null;
    var data = new Float32Array(atoms.length * 3);

    for (var i = 0; i < atoms.length; ++i) {
      var atom = atoms[i] || {};
      var position = atom.position || atom.pos || atom.xyz || [atom.x, atom.y, atom.z];
      if (!position || position.length < 3) return null;

      data[i * 3 + 0] = Number(position[0]) || 0;
      data[i * 3 + 1] = Number(position[1]) || 0;
      data[i * 3 + 2] = Number(position[2]) || 0;
    }

    return data;
  }

  function normalizeFrame(frame, atomCount) {
    if (!frame && frame !== 0) return null;

    if (ArrayBuffer.isView(frame) || Array.isArray(frame)) {
      var flat = toFiniteArray(frame);
      if (flat.length === atomCount * 3) {
        return new Float32Array(
          flat.map(function (value) {
            return Number(value) || 0;
          })
        );
      }
    }

    if (frame.positions) return normalizeFrame(frame.positions, atomCount);
    if (frame.coordinates) return normalizeFrame(frame.coordinates, atomCount);
    if (frame.xyz) return normalizeFrame(frame.xyz, atomCount);
    if (frame.atoms) return flattenAtomPositions(frame.atoms);

    if (frame.x && frame.y && frame.z) {
      var xs = toFiniteArray(frame.x);
      var ys = toFiniteArray(frame.y);
      var zs = toFiniteArray(frame.z);
      if (xs.length === atomCount && ys.length === atomCount && zs.length === atomCount) {
        var interleaved = new Float32Array(atomCount * 3);
        for (var i = 0; i < atomCount; ++i) {
          interleaved[i * 3 + 0] = Number(xs[i]) || 0;
          interleaved[i * 3 + 1] = Number(ys[i]) || 0;
          interleaved[i * 3 + 2] = Number(zs[i]) || 0;
        }
        return interleaved;
      }
    }

    return null;
  }

  function flattenAtomVectors(atoms, fieldNames) {
    if (!Array.isArray(atoms)) return null;
    var data = new Float32Array(atoms.length * 3);

    for (var i = 0; i < atoms.length; ++i) {
      var atom = atoms[i] || {};
      var vector = null;
      for (var keyIndex = 0; keyIndex < fieldNames.length; ++keyIndex) {
        var key = fieldNames[keyIndex];
        if (atom[key]) {
          vector = atom[key];
          break;
        }
      }

      if (!vector || vector.length < 3) return null;

      data[i * 3 + 0] = Number(vector[0]) || 0;
      data[i * 3 + 1] = Number(vector[1]) || 0;
      data[i * 3 + 2] = Number(vector[2]) || 0;
    }

    return data;
  }

  function negateVectorFrame(frame) {
    if (!frame) return null;
    var out = new Float32Array(frame.length);
    for (var i = 0; i < frame.length; ++i) {
      out[i] = -frame[i];
    }
    return out;
  }

  function normalizeVectorFrame(frame, atomCount, fieldNames) {
    if (!frame && frame !== 0) return null;

    if (ArrayBuffer.isView(frame) || Array.isArray(frame)) {
      var flat = toFiniteArray(frame);
      if (flat.length === atomCount * 3) {
        return new Float32Array(
          flat.map(function (value) {
            return Number(value) || 0;
          })
        );
      }
    }

    for (var keyIndex = 0; keyIndex < fieldNames.length; ++keyIndex) {
      var key = fieldNames[keyIndex];
      if (frame[key]) return normalizeVectorFrame(frame[key], atomCount, fieldNames);
    }

    if (frame.atoms) return flattenAtomVectors(frame.atoms, fieldNames);

    return null;
  }

  function normalizeForceFrame(frame, atomCount) {
    var forces = normalizeVectorFrame(frame, atomCount, ["forces", "force", "f"]);
    if (forces) return forces;

    var gradients = normalizeVectorFrame(frame, atomCount, ["gradients", "gradient", "g"]);
    return gradients ? negateVectorFrame(gradients) : null;
  }

  function normalizeTrajectory(input, atomCount) {
    var frames = input.frames || input.trajectory || input.snapshots;
    var normalized = [];
    var forceFrames = [];
    var hasForceFrames = false;

    if (Array.isArray(frames) && frames.length) {
      for (var i = 0; i < frames.length; ++i) {
        var frame = normalizeFrame(frames[i], atomCount);
        if (frame) {
          var forceFrame = normalizeForceFrame(frames[i], atomCount);
          normalized.push(frame);
          forceFrames.push(forceFrame);
          hasForceFrames = hasForceFrames || !!forceFrame;
        }
      }
    }

    if (!normalized.length) {
      var single = normalizeFrame(input.positions || input.coordinates || input.xyz || input.atoms, atomCount);
      if (single) {
        var singleForceFrame = normalizeForceFrame(input, atomCount);
        normalized.push(single);
        forceFrames.push(singleForceFrame);
        hasForceFrames = hasForceFrames || !!singleForceFrame;
      }
    }

    return {
      frames: normalized,
      forceFrames: hasForceFrames ? forceFrames : [],
    };
  }

  function getScenePositionScale(input) {
    var unit = String(
      input.positionUnits ||
      input.position_units ||
      input.coordinateUnits ||
      input.coordinate_units ||
      ""
    ).trim().toLowerCase();

    if (!unit) return 1.0;
    if (unit === "bohr" || unit === "bohrs" || unit === "a0" || unit === "au") return 1.0;
    if (unit.indexOf("angstrom") >= 0) return ANGSTROM_TO_BOHR;
    return 1.0;
  }

  function scaleFramePositions(frame, scale) {
    if (!(scale > 0) || Math.abs(scale - 1.0) < 1e-6) return frame;

    var scaled = new Float32Array(frame.length);
    for (var i = 0; i < frame.length; ++i) {
      scaled[i] = frame[i] * scale;
    }
    return scaled;
  }

  function normalizeAtomColors(raw, atomicNumbers) {
    var atomCount = atomicNumbers.length;
    var colors = new Float32Array(atomCount * 3);
    var values = raw || [];

    for (var i = 0; i < atomCount; ++i) {
      var fallback = getElementVisual(atomicNumbers[i]).color;
      var color = null;

      if (Array.isArray(values) && values.length === atomCount * 3) {
        var r = Number(values[i * 3 + 0]);
        var g = Number(values[i * 3 + 1]);
        var b = Number(values[i * 3 + 2]);
        if (isFinite(r) && isFinite(g) && isFinite(b)) {
          if (r > 1.0 || g > 1.0 || b > 1.0) {
            color = [r / 255.0, g / 255.0, b / 255.0];
          } else {
            color = [r, g, b];
          }
        }
      } else if (Array.isArray(values) && values.length === atomCount) {
        var value = values[i];
        if (Array.isArray(value) && value.length >= 3) {
          var arrR = Number(value[0]);
          var arrG = Number(value[1]);
          var arrB = Number(value[2]);
          if (isFinite(arrR) && isFinite(arrG) && isFinite(arrB)) {
            if (arrR > 1.0 || arrG > 1.0 || arrB > 1.0) {
              color = [arrR / 255.0, arrG / 255.0, arrB / 255.0];
            } else {
              color = [arrR, arrG, arrB];
            }
          }
        } else {
          color = parseHexColor(value);
        }
      }

      color = color || fallback;
      colors[i * 3 + 0] = clampNumber(color[0], 0, 1, fallback[0]);
      colors[i * 3 + 1] = clampNumber(color[1], 0, 1, fallback[1]);
      colors[i * 3 + 2] = clampNumber(color[2], 0, 1, fallback[2]);
    }

    return colors;
  }

  function normalizeAtomRadii(raw, atomicNumbers) {
    var atomCount = atomicNumbers.length;
    var radii = new Float32Array(atomCount);
    var values = toFiniteArray(raw);

    for (var i = 0; i < atomCount; ++i) {
      var fallback = getElementVisual(atomicNumbers[i]).radius;
      radii[i] = clampNumber(values[i], MIN_ATOM_RADIUS, MAX_ATOM_RADIUS, fallback);
    }

    return radii;
  }

  function normalizeBondList(raw, atomCount) {
    if (!Array.isArray(raw)) return [];

    var bonds = [];
    var seen = {};

    for (var i = 0; i < raw.length; ++i) {
      var item = raw[i];
      var a = null;
      var b = null;

      if (Array.isArray(item) && item.length >= 2) {
        a = Number(item[0]);
        b = Number(item[1]);
      } else if (item && typeof item === "object") {
        a = Number(item.a ?? item.i ?? item.source ?? item.from ?? item.atomA);
        b = Number(item.b ?? item.j ?? item.target ?? item.to ?? item.atomB);
      }

      a = Math.trunc(a);
      b = Math.trunc(b);

      if (!isFinite(a) || !isFinite(b) || a === b) continue;
      if (a < 0 || b < 0 || a >= atomCount || b >= atomCount) continue;

      var lo = Math.min(a, b);
      var hi = Math.max(a, b);
      var key = lo + ":" + hi;
      if (seen[key]) continue;
      seen[key] = true;
      bonds.push([lo, hi]);
    }

    return bonds;
  }

  function xmlLocalName(node) {
    return (node && (node.localName || node.nodeName || "")).split(":").pop();
  }

  function findFirstXmlNode(root, name) {
    var all = root && typeof root.getElementsByTagName === "function" ? root.getElementsByTagName("*") : [];
    for (var i = 0; i < all.length; ++i) {
      if (xmlLocalName(all[i]) === name) return all[i];
    }
    return null;
  }

  function xmlChildrenByLocalName(parent, name) {
    if (!parent || !parent.children) return [];

    var out = [];
    for (var i = 0; i < parent.children.length; ++i) {
      if (xmlLocalName(parent.children[i]) === name) out.push(parent.children[i]);
    }
    return out;
  }

  function parseXmlNumericList(parent, childName) {
    var nodes = xmlChildrenByLocalName(parent, childName);
    var values = [];

    for (var i = 0; i < nodes.length; ++i) {
      var value = Number((nodes[i].textContent || "").trim());
      if (!isFinite(value)) {
        throw new Error("Invalid numeric value in <" + childName + ">.");
      }
      values.push(value);
    }

    return values;
  }

  function getPubChemXmlCoordinateScale(doc, fallbackScale) {
    var scale = Number(fallbackScale);
    if (!(scale > 0)) scale = ANGSTROM_TO_BOHR;

    var all = doc && typeof doc.getElementsByTagName === "function" ? doc.getElementsByTagName("*") : [];
    for (var i = 0; i < all.length; ++i) {
      if (xmlLocalName(all[i]) !== "PC-CoordinateType") continue;

      var unit = String(all[i].getAttribute("value") || "").trim().toLowerCase();
      if (!unit) continue;
      if (unit === "units-angstroms") return ANGSTROM_TO_BOHR;
      if (unit === "units-bohr" || unit === "units-bohrs") return 1.0;
    }

    return scale;
  }

  function parsePubChemXmlBonds(doc, atomAids, coordAids, atomCount) {
    var aid1El = findFirstXmlNode(doc, "PC-Bonds_aid1");
    var aid2El = findFirstXmlNode(doc, "PC-Bonds_aid2");
    if (!aid1El || !aid2El) return null;

    var aid1List = parseXmlNumericList(aid1El, "PC-Bonds_aid1_E").map(function (value) {
      return Math.trunc(value);
    });
    var aid2List = parseXmlNumericList(aid2El, "PC-Bonds_aid2_E").map(function (value) {
      return Math.trunc(value);
    });

    if (!aid1List.length || aid1List.length !== aid2List.length) {
      return null;
    }

    var orderedAids = [];
    if (coordAids.length === atomCount) {
      orderedAids = coordAids.slice();
    } else if (atomAids.length === atomCount) {
      orderedAids = atomAids.slice();
    } else {
      return null;
    }

    var indexByAid = {};
    for (var aidIndex = 0; aidIndex < orderedAids.length; ++aidIndex) {
      indexByAid[Math.trunc(orderedAids[aidIndex])] = aidIndex;
    }

    var bonds = [];
    var seen = {};
    for (var bondIndex = 0; bondIndex < aid1List.length; ++bondIndex) {
      var a = indexByAid[aid1List[bondIndex]];
      var b = indexByAid[aid2List[bondIndex]];
      if (!isFinite(a) || !isFinite(b) || a === b) continue;

      var lo = Math.min(a, b);
      var hi = Math.max(a, b);
      var key = lo + ":" + hi;
      if (seen[key]) continue;
      seen[key] = true;
      bonds.push([lo, hi]);
    }

    return bonds.length ? bonds : null;
  }

  function parsePubChemXmlScene(xmlText, options) {
    var opts = options || {};
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlText, "application/xml");
    var parserErrors = doc.getElementsByTagName("parsererror");

    if (parserErrors && parserErrors.length) {
      throw new Error("Unable to parse molecule XML.");
    }

    var atomsAidEl = findFirstXmlNode(doc, "PC-Atoms_aid");
    var atomsEl = findFirstXmlNode(doc, "PC-Atoms_element");
    var coordsAidEl = findFirstXmlNode(doc, "PC-Coordinates_aid");
    var xEl = findFirstXmlNode(doc, "PC-Conformer_x");
    var yEl = findFirstXmlNode(doc, "PC-Conformer_y");
    var zEl = findFirstXmlNode(doc, "PC-Conformer_z");

    if (!atomsEl || !xEl || !yEl || !zEl) {
      throw new Error("Missing atom or coordinate data in XML.");
    }

    var atomNumbers = parseXmlNumericList(atomsEl, "PC-Element").map(function (value) {
      return Math.max(1, Math.trunc(value));
    });
    var xs = parseXmlNumericList(xEl, "PC-Conformer_x_E");
    var ys = parseXmlNumericList(yEl, "PC-Conformer_y_E");
    var zs = parseXmlNumericList(zEl, "PC-Conformer_z_E");

    if (atomNumbers.length !== xs.length || xs.length !== ys.length || ys.length !== zs.length) {
      throw new Error("Atom and coordinate counts do not match.");
    }

    var coordinateScale = getPubChemXmlCoordinateScale(doc, opts.coordinateScale);
    var atomAids = atomsAidEl ? parseXmlNumericList(atomsAidEl, "PC-Atoms_aid_E") : [];
    var coordAids = coordsAidEl ? parseXmlNumericList(coordsAidEl, "PC-Coordinates_aid_E") : [];
    var orderedAtomicNumbers = atomNumbers.slice();

    if (atomAids.length === atomNumbers.length && coordAids.length === atomNumbers.length) {
      var atomicNumberByAid = {};
      for (var atomIndex = 0; atomIndex < atomNumbers.length; ++atomIndex) {
        atomicNumberByAid[Math.trunc(atomAids[atomIndex])] = atomNumbers[atomIndex];
      }

      orderedAtomicNumbers = coordAids.map(function (aid) {
        return atomicNumberByAid[Math.trunc(aid)] || 1;
      });
    }

    var positions = new Float32Array(orderedAtomicNumbers.length * 3);
    for (var i = 0; i < orderedAtomicNumbers.length; ++i) {
      positions[i * 3 + 0] = xs[i] * coordinateScale;
      positions[i * 3 + 1] = ys[i] * coordinateScale;
      positions[i * 3 + 2] = zs[i] * coordinateScale;
    }

    var bonds = parsePubChemXmlBonds(doc, atomAids, coordAids, orderedAtomicNumbers.length);

    var scene = {
      label: opts.label || "Caffeine",
      atomicNumbers: orderedAtomicNumbers,
      positions: positions,
    };

    if (bonds) {
      scene.bonds = bonds;
    }

    return scene;
  }

  function ensureDefaultBallstickScene() {
    if (defaultBallstickScene) {
      return Promise.resolve(defaultBallstickScene);
    }

    if (defaultBallstickScenePromise) {
      return defaultBallstickScenePromise;
    }

    defaultBallstickScenePromise = fetch(DEFAULT_BALLSTICK_XML_URL)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load Caffeine.xml.");
        }
        return response.text();
      })
      .then(function (xmlText) {
        defaultBallstickScene = parsePubChemXmlScene(xmlText, { label: "Caffeine" });
        defaultBallstickScenePromise = null;
        return defaultBallstickScene;
      })
      .catch(function (err) {
        defaultBallstickScenePromise = null;
        throw err;
      });

    return defaultBallstickScenePromise;
  }

  function hasCurrentJobMoleculeSource() {
    return typeof window.getCurrentMoleculeSceneSource === "function" && !!window.getCurrentMoleculeSceneSource();
  }

  function getCurrentJobMoleculeSourceKey() {
    if (typeof window.getCurrentMoleculeSceneSourceKey !== "function") return "";
    return String(window.getCurrentMoleculeSceneSourceKey() || "");
  }

  function moleculeSceneMatchesCurrentJobSource() {
    var sourceKey = getCurrentJobMoleculeSourceKey();
    if (!sourceKey) return !!moleculeState.scene;
    return moleculeState.sourceKey === sourceKey;
  }

  function syncCachedCameras() {
    if (!camera) return;
    volumeCamera = camera;
    moleculeCamera = camera;
  }

  function normalizeVisualizationMode(mode) {
    if (mode === "volume+ballstick") return "volume_ballstick";
    if (mode === "volume_ballstick") return "volume_ballstick";
    if (mode === "ballstick") return "ballstick";
    if (mode === "volume") return "volume";
    return "iso";
  }

  function selectionShowsVolume(selection) {
    return selection === "volume" || selection === "volume_ballstick";
  }

  function selectionShowsBallstick(selection) {
    return selection === "ballstick" || selection === "volume_ballstick";
  }

  function selectionUsesVolumeShader(selection) {
    return selection !== "iso";
  }

  function getEffectiveVizSelection() {
    return pendingBallstickSelection || currentVizSelection;
  }

  function loadCurrentJobBallstickScene(selection, options) {
    var opts = options || {};
    if (typeof window.loadCurrentJobMoleculeScene !== "function" || !hasCurrentJobMoleculeSource()) {
      return Promise.resolve(false);
    }

    return Promise.resolve(
      window.loadCurrentJobMoleculeScene({
        autoEnterMode: true,
        preserveCamera: !!opts.preserveCamera,
        visualizationMode: normalizeVisualizationMode(selection),
      })
    ).then(function (loaded) {
      return !!loaded;
    });
  }

  function inferBonds(atomicNumbers, frame, radii) {
    var atomCount = atomicNumbers.length;
    var bonds = [];

    for (var i = 0; i < atomCount; ++i) {
      for (var j = i + 1; j < atomCount; ++j) {
        var dx = frame[i * 3 + 0] - frame[j * 3 + 0];
        var dy = frame[i * 3 + 1] - frame[j * 3 + 1];
        var dz = frame[i * 3 + 2] - frame[j * 3 + 2];
        var distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= 0.0001) continue;

        var cutoff = Math.max(MIN_BOND_CUTOFF, 1.15 * (radii[i] + radii[j]));
        if (distSq <= cutoff * cutoff) {
          bonds.push([i, j]);
        }
      }
    }

    return bonds;
  }

  function computeSceneBounds(frames) {
    var minX = Infinity;
    var minY = Infinity;
    var minZ = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var maxZ = -Infinity;

    for (var frameIndex = 0; frameIndex < frames.length; ++frameIndex) {
      var frame = frames[frameIndex];
      for (var i = 0; i < frame.length; i += 3) {
        var x = frame[i + 0];
        var y = frame[i + 1];
        var z = frame[i + 2];

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }

    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    };
  }

  function computeMaxVectorMagnitude(frames) {
    var maxMagnitude = 0;
    if (!Array.isArray(frames)) return maxMagnitude;

    for (var frameIndex = 0; frameIndex < frames.length; ++frameIndex) {
      var frame = frames[frameIndex];
      if (!frame) continue;

      for (var i = 0; i < frame.length; i += 3) {
        var x = frame[i + 0];
        var y = frame[i + 1];
        var z = frame[i + 2];
        var magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude > maxMagnitude) maxMagnitude = magnitude;
      }
    }

    return maxMagnitude;
  }

  function normalizeMoleculeScene(input) {
    var root = input && typeof input === "object" ? input : null;
    var scene = root;
    if (!scene) return null;

    if (scene.moleculeScene && typeof scene.moleculeScene === "object") {
      scene = scene.moleculeScene;
    } else if (scene.visualization && typeof scene.visualization === "object") {
      scene = scene.visualization;
    } else if (scene.MolecularDynamics && typeof scene.MolecularDynamics === "object") {
      scene = Object.assign({}, scene.MolecularDynamics, {
        label:
          scene.MolecularDynamics.label ||
          root.label ||
          root.name ||
          "MD Trajectory",
        visualizationLock: "ballstick",
      });
    }

    var atomicNumbers = normalizeAtomicNumbers(scene);
    if (!atomicNumbers.length) return null;

    var trajectory = normalizeTrajectory(scene, atomicNumbers.length);
    var frames = trajectory.frames;
    var forceFrames = trajectory.forceFrames;
    if (!frames.length) return null;

    var positionScale = getScenePositionScale(scene);
    if (Math.abs(positionScale - 1.0) >= 1e-6) {
      frames = frames.map(function (frame) {
        return scaleFramePositions(frame, positionScale);
      });
    }

    var atomColors = normalizeAtomColors(scene.atomColors || scene.colors, atomicNumbers);
    var atomRadii = normalizeAtomRadii(scene.atomRadii || scene.radii, atomicNumbers);
    var hasExplicitBonds = Array.isArray(scene.bonds);
    var bonds = normalizeBondList(scene.bonds, atomicNumbers.length);
    var dynamicBonds = false;

    if (!bonds.length && !hasExplicitBonds) {
      bonds = inferBonds(atomicNumbers, frames[0], atomRadii);
      dynamicBonds = frames.length > 1;
    }

    var bounds = computeSceneBounds(frames);
    var center = [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ];

    var dx = bounds.max[0] - bounds.min[0];
    var dy = bounds.max[1] - bounds.min[1];
    var dz = bounds.max[2] - bounds.min[2];
    var maxRadius = 0;
    for (var i = 0; i < atomRadii.length; ++i) {
      if (atomRadii[i] > maxRadius) maxRadius = atomRadii[i];
    }

    var radius = Math.max(1.0, 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz) + maxRadius * 1.8);
    var maxForceMagnitude = computeMaxVectorMagnitude(forceFrames);
    var forceScale = maxForceMagnitude > 0
      ? (radius * FORCE_ARROW_MAX_LENGTH_RATIO) / maxForceMagnitude
      : 0;

    return {
      label: scene.label || scene.name || scene.detail || "",
      atomicNumbers: atomicNumbers,
      frames: frames,
      forceFrames: forceFrames,
      forceScale: forceScale,
      forceUnits: scene.forceUnits || scene.force_units || scene.gradientUnits || scene.gradient_units || "",
      atomColors: atomColors,
      atomRadii: atomRadii,
      bonds: bonds,
      dynamicBonds: dynamicBonds,
      center: center,
      radius: radius,
      visualizationLock: scene.visualizationLock || "",
    };
  }

  function createSphereGeometry(latitudeSegments, longitudeSegments) {
    var positions = [];
    var normals = [];
    var indices = [];

    for (var lat = 0; lat <= latitudeSegments; ++lat) {
      var v = lat / latitudeSegments;
      var phi = v * Math.PI;
      var sinPhi = Math.sin(phi);
      var cosPhi = Math.cos(phi);

      for (var lon = 0; lon <= longitudeSegments; ++lon) {
        var u = lon / longitudeSegments;
        var theta = u * Math.PI * 2.0;
        var sinTheta = Math.sin(theta);
        var cosTheta = Math.cos(theta);

        var x = cosTheta * sinPhi;
        var y = cosPhi;
        var z = sinTheta * sinPhi;

        positions.push(x, y, z);
        normals.push(x, y, z);
      }
    }

    for (var latIndex = 0; latIndex < latitudeSegments; ++latIndex) {
      for (var lonIndex = 0; lonIndex < longitudeSegments; ++lonIndex) {
        var rowStride = longitudeSegments + 1;
        var a = latIndex * rowStride + lonIndex;
        var b = a + rowStride;

        indices.push(a, b, a + 1);
        indices.push(b, b + 1, a + 1);
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
    };
  }

  function createCylinderGeometry(radialSegments) {
    var positions = [];
    var normals = [];
    var indices = [];

    for (var segment = 0; segment <= radialSegments; ++segment) {
      var t = (segment / radialSegments) * Math.PI * 2.0;
      var x = Math.cos(t);
      var z = Math.sin(t);

      positions.push(x, -0.5, z);
      normals.push(x, 0.0, z);

      positions.push(x, 0.5, z);
      normals.push(x, 0.0, z);
    }

    for (var index = 0; index < radialSegments; ++index) {
      var base = index * 2;
      indices.push(base + 0, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
    };
  }

  function createConeGeometry(radialSegments) {
    var positions = [0, 0.5, 0];
    var normals = [0, 1, 0];
    var indices = [];

    for (var segment = 0; segment <= radialSegments; ++segment) {
      var t = (segment / radialSegments) * Math.PI * 2.0;
      var x = Math.cos(t);
      var z = Math.sin(t);

      positions.push(x, -0.5, z);
      normals.push(x, 0.35, z);
    }

    var baseCenterIndex = positions.length / 3;
    positions.push(0, -0.5, 0);
    normals.push(0, -1, 0);

    for (var index = 0; index < radialSegments; ++index) {
      var baseA = 1 + index;
      var baseB = 1 + index + 1;
      indices.push(0, baseA, baseB);
      indices.push(baseCenterIndex, baseB, baseA);
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
    };
  }

  function createInstancedMesh(geometry) {
    var mesh = {
      vao: gl.createVertexArray(),
      indexCount: geometry.indices.length,
      instanceCount: 0,
      modelBuffer: gl.createBuffer(),
      colorBuffer: gl.createBuffer(),
    };

    gl.bindVertexArray(mesh.vao);

    var positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    var normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    var indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.modelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 64, gl.DYNAMIC_DRAW);
    for (var i = 0; i < 4; ++i) {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(2 + i, 1);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 12, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1);

    gl.bindVertexArray(null);
    return mesh;
  }

  function ensureMoleculeRenderer() {
    if (!gl || moleculeShader) return;

    moleculeShader = new Shader(gl, vertShaderMesh, fragShaderMesh);
    moleculeAtomMesh = createInstancedMesh(createSphereGeometry(14, 18));
    moleculeBondMesh = createInstancedMesh(createCylinderGeometry(18));
    moleculeForceShaftMesh = createInstancedMesh(createCylinderGeometry(10));
    moleculeForceHeadMesh = createInstancedMesh(createConeGeometry(14));
  }

  function uploadInstanceData(mesh, modelData, colorData, instanceCount) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.modelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, modelData, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_DRAW);

    mesh.instanceCount = instanceCount;
  }

  function clearInstanceData(mesh) {
    if (!mesh) return;
    uploadInstanceData(mesh, new Float32Array(16), new Float32Array(3), 0);
  }

  function writeSphereMatrix(out, offset, x, y, z, scale) {
    out[offset + 0] = scale;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;

    out[offset + 4] = 0;
    out[offset + 5] = scale;
    out[offset + 6] = 0;
    out[offset + 7] = 0;

    out[offset + 8] = 0;
    out[offset + 9] = 0;
    out[offset + 10] = scale;
    out[offset + 11] = 0;

    out[offset + 12] = x;
    out[offset + 13] = y;
    out[offset + 14] = z;
    out[offset + 15] = 1;
  }

  function writeCylinderMatrix(out, offset, ax, ay, az, bx, by, bz, radius) {
    var dx = bx - ax;
    var dy = by - ay;
    var dz = bz - az;
    var length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(length > 1e-5)) return false;

    var yx = dx / length;
    var yy = dy / length;
    var yz = dz / length;

    var refX = Math.abs(yy) < 0.999 ? 0 : 1;
    var refY = Math.abs(yy) < 0.999 ? 1 : 0;
    var refZ = 0;

    var xx = refY * yz - refZ * yy;
    var xy = refZ * yx - refX * yz;
    var xz = refX * yy - refY * yx;
    var xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);
    if (!(xLen > 1e-6)) return false;

    xx /= xLen;
    xy /= xLen;
    xz /= xLen;

    var zx = yy * xz - yz * xy;
    var zy = yz * xx - yx * xz;
    var zz = yx * xy - yy * xx;

    var midX = (ax + bx) * 0.5;
    var midY = (ay + by) * 0.5;
    var midZ = (az + bz) * 0.5;

    out[offset + 0] = xx * radius;
    out[offset + 1] = xy * radius;
    out[offset + 2] = xz * radius;
    out[offset + 3] = 0;

    out[offset + 4] = yx * length;
    out[offset + 5] = yy * length;
    out[offset + 6] = yz * length;
    out[offset + 7] = 0;

    out[offset + 8] = zx * radius;
    out[offset + 9] = zy * radius;
    out[offset + 10] = zz * radius;
    out[offset + 11] = 0;

    out[offset + 12] = midX;
    out[offset + 13] = midY;
    out[offset + 14] = midZ;
    out[offset + 15] = 1;

    return true;
  }

  function hasMoleculeForceData() {
    return !!(
      moleculeState.scene &&
      Array.isArray(moleculeState.scene.forceFrames) &&
      moleculeState.scene.forceFrames.length &&
      moleculeState.scene.forceFrames.some(function (frame) {
        return !!frame;
      })
    );
  }

  function rebuildMoleculeForceInstanceData(scene, frame, atomRenderRadii) {
    if (!moleculeForceShaftMesh || !moleculeForceHeadMesh) return;

    if (!uiState.show_forces || !scene || !frame || !hasMoleculeForceData()) {
      clearInstanceData(moleculeForceShaftMesh);
      clearInstanceData(moleculeForceHeadMesh);
      return;
    }

    var forceFrame = scene.forceFrames[moleculeState.frameIndex] || null;
    var atomCount = scene.atomicNumbers.length;
    var forceScale = Number(scene.forceScale) || 0;
    if (!forceFrame || !(forceScale > 0)) {
      clearInstanceData(moleculeForceShaftMesh);
      clearInstanceData(moleculeForceHeadMesh);
      return;
    }

    var shaftModels = new Float32Array(atomCount * 16);
    var shaftColors = new Float32Array(atomCount * 3);
    var headModels = new Float32Array(atomCount * 16);
    var headColors = new Float32Array(atomCount * 3);
    var shaftCount = 0;
    var headCount = 0;
    var shaftRadius = Math.max(0.012, Math.min(0.055, scene.radius * FORCE_ARROW_SHAFT_RADIUS_RATIO));
    var headRadius = Math.max(shaftRadius * 2.2, Math.min(0.16, scene.radius * FORCE_ARROW_HEAD_RADIUS_RATIO));
    var maxHeadLength = Math.max(shaftRadius * 4.0, scene.radius * FORCE_ARROW_HEAD_LENGTH_RATIO);

    for (var atomIndex = 0; atomIndex < atomCount; ++atomIndex) {
      var fx = forceFrame[atomIndex * 3 + 0];
      var fy = forceFrame[atomIndex * 3 + 1];
      var fz = forceFrame[atomIndex * 3 + 2];
      var magnitude = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (!(magnitude > 1e-10)) continue;

      var dirX = fx / magnitude;
      var dirY = fy / magnitude;
      var dirZ = fz / magnitude;
      var arrowLength = magnitude * forceScale;
      if (!(arrowLength > shaftRadius * 3.0)) continue;

      var px = frame[atomIndex * 3 + 0];
      var py = frame[atomIndex * 3 + 1];
      var pz = frame[atomIndex * 3 + 2];
      var atomRadius = atomRenderRadii[atomIndex] || 0;
      var originX = px + dirX * atomRadius * 1.05;
      var originY = py + dirY * atomRadius * 1.05;
      var originZ = pz + dirZ * atomRadius * 1.05;
      var tipX = originX + dirX * arrowLength;
      var tipY = originY + dirY * arrowLength;
      var tipZ = originZ + dirZ * arrowLength;
      var headLength = Math.min(maxHeadLength, arrowLength * 0.42);
      var shaftLength = Math.max(0, arrowLength - headLength);

      if (shaftLength > shaftRadius * 2.0) {
        var shaftEndX = tipX - dirX * headLength;
        var shaftEndY = tipY - dirY * headLength;
        var shaftEndZ = tipZ - dirZ * headLength;
        if (
          writeCylinderMatrix(
            shaftModels,
            shaftCount * 16,
            originX,
            originY,
            originZ,
            shaftEndX,
            shaftEndY,
            shaftEndZ,
            shaftRadius
          )
        ) {
          shaftColors[shaftCount * 3 + 0] = FORCE_ARROW_COLOR[0];
          shaftColors[shaftCount * 3 + 1] = FORCE_ARROW_COLOR[1];
          shaftColors[shaftCount * 3 + 2] = FORCE_ARROW_COLOR[2];
          shaftCount += 1;
        }
      }

      var headBaseX = tipX - dirX * headLength;
      var headBaseY = tipY - dirY * headLength;
      var headBaseZ = tipZ - dirZ * headLength;
      if (
        writeCylinderMatrix(
          headModels,
          headCount * 16,
          headBaseX,
          headBaseY,
          headBaseZ,
          tipX,
          tipY,
          tipZ,
          headRadius
        )
      ) {
        headColors[headCount * 3 + 0] = FORCE_ARROW_COLOR[0];
        headColors[headCount * 3 + 1] = FORCE_ARROW_COLOR[1];
        headColors[headCount * 3 + 2] = FORCE_ARROW_COLOR[2];
        headCount += 1;
      }
    }

    if (shaftCount) {
      uploadInstanceData(
        moleculeForceShaftMesh,
        shaftModels.subarray(0, shaftCount * 16),
        shaftColors.subarray(0, shaftCount * 3),
        shaftCount
      );
    } else {
      clearInstanceData(moleculeForceShaftMesh);
    }

    if (headCount) {
      uploadInstanceData(
        moleculeForceHeadMesh,
        headModels.subarray(0, headCount * 16),
        headColors.subarray(0, headCount * 3),
        headCount
      );
    } else {
      clearInstanceData(moleculeForceHeadMesh);
    }
  }

  function rebuildMoleculeInstanceData() {
    if (!gl || !moleculeState.scene) return;
    ensureMoleculeRenderer();

    var scene = moleculeState.scene;
    var frame = scene.frames[moleculeState.frameIndex] || scene.frames[0];
    if (!frame) return;

    var atomCount = scene.atomicNumbers.length;
    var atomModels = new Float32Array(atomCount * 16);
    var atomColors = new Float32Array(atomCount * 3);
    var atomRenderRadii = new Float32Array(atomCount);

    for (var atomIndex = 0; atomIndex < atomCount; ++atomIndex) {
      var px = frame[atomIndex * 3 + 0];
      var py = frame[atomIndex * 3 + 1];
      var pz = frame[atomIndex * 3 + 2];
      var radius = Math.max(0.08, scene.atomRadii[atomIndex] * BALLSTICK_ATOM_SCALE);
      atomRenderRadii[atomIndex] = radius;

      writeSphereMatrix(atomModels, atomIndex * 16, px, py, pz, radius);

      atomColors[atomIndex * 3 + 0] = scene.atomColors[atomIndex * 3 + 0];
      atomColors[atomIndex * 3 + 1] = scene.atomColors[atomIndex * 3 + 1];
      atomColors[atomIndex * 3 + 2] = scene.atomColors[atomIndex * 3 + 2];
    }

    uploadInstanceData(moleculeAtomMesh, atomModels, atomColors, atomCount);

    var activeBonds = scene.dynamicBonds
      ? inferBonds(scene.atomicNumbers, frame, scene.atomRadii)
      : scene.bonds;
    var maxBondCount = activeBonds.length;
    var bondModels = new Float32Array(Math.max(1, maxBondCount) * 16);
    var bondColors = new Float32Array(Math.max(1, maxBondCount) * 3);
    var actualBondCount = 0;

    for (var bondIndex = 0; bondIndex < activeBonds.length; ++bondIndex) {
      var bond = activeBonds[bondIndex];
      var a = bond[0];
      var b = bond[1];
      var ax = frame[a * 3 + 0];
      var ay = frame[a * 3 + 1];
      var az = frame[a * 3 + 2];
      var bx = frame[b * 3 + 0];
      var by = frame[b * 3 + 1];
      var bz = frame[b * 3 + 2];
      var dx = bx - ax;
      var dy = by - ay;
      var dz = bz - az;
      var bondLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(bondLength > 1e-5)) continue;

      var dirX = dx / bondLength;
      var dirY = dy / bondLength;
      var dirZ = dz / bondLength;
      var bondRadius = BALLSTICK_BOND_RADIUS;
      var trimA = Math.min(
        bondLength * 0.35,
        Math.max(bondRadius * 0.75, atomRenderRadii[a] * 0.82)
      );
      var trimB = Math.min(
        bondLength * 0.35,
        Math.max(bondRadius * 0.75, atomRenderRadii[b] * 0.82)
      );
      var startX = ax + dirX * trimA;
      var startY = ay + dirY * trimA;
      var startZ = az + dirZ * trimA;
      var endX = bx - dirX * trimB;
      var endY = by - dirY * trimB;
      var endZ = bz - dirZ * trimB;

      var ok = writeCylinderMatrix(
        bondModels,
        actualBondCount * 16,
        startX,
        startY,
        startZ,
        endX,
        endY,
        endZ,
        bondRadius
      );

      if (!ok) continue;

      bondColors[actualBondCount * 3 + 0] =
        0.5 * (scene.atomColors[a * 3 + 0] + scene.atomColors[b * 3 + 0]);
      bondColors[actualBondCount * 3 + 1] =
        0.5 * (scene.atomColors[a * 3 + 1] + scene.atomColors[b * 3 + 1]);
      bondColors[actualBondCount * 3 + 2] =
        0.5 * (scene.atomColors[a * 3 + 2] + scene.atomColors[b * 3 + 2]);
      actualBondCount += 1;
    }

    if (!actualBondCount) {
      clearInstanceData(moleculeBondMesh);
    } else {
      uploadInstanceData(
        moleculeBondMesh,
        bondModels.subarray(0, actualBondCount * 16),
        bondColors.subarray(0, actualBondCount * 3),
        actualBondCount
      );
    }

    rebuildMoleculeForceInstanceData(scene, frame, atomRenderRadii);
  }

  function getMoleculeFrameCount() {
    return moleculeState.scene ? moleculeState.scene.frames.length : 0;
  }

  function sceneRequiresBallstickOnly() {
    return !!(moleculeState.scene && moleculeState.scene.visualizationLock === "ballstick");
  }

  function syncBallstickAvailability() {
    var toggle = document.getElementById("vizModeBallstick");
    if (!toggle) return;

    var hasScene = !!moleculeState.scene;
    toggle.title = sceneRequiresBallstickOnly()
      ? "This trajectory is currently rendered in Ball & Stick only."
      : hasScene
        ? ""
        : "Loads the active job molecule if available.";
  }

  function syncForceUi(selection) {
    var group = document.getElementById("vizForceOptions");
    var toggle = document.getElementById("vizShowForces");
    if (!toggle && !group) return;

    var hasForces = hasMoleculeForceData();
    var canShowForces = hasForces && selectionShowsBallstick(selection);
    if (!hasForces) {
      uiState.show_forces = false;
    }

    if (group) {
      group.hidden = !canShowForces;
    }

    if (!toggle) return;
    toggle.checked = !!uiState.show_forces && canShowForces;
    toggle.disabled = !canShowForces;
    toggle.title = canShowForces
      ? "Show force vectors for the current MD frame."
      : hasForces
        ? "Enable Ball & Stick to show force vectors."
        : "No per-frame force vectors are available for this molecule.";
  }

  function syncPlaybackUi() {
    var group = document.getElementById("vizGroupPlayback");
    var playButton = document.getElementById("vizPlaybackToggleBtn");
    var simMoreFramesButton = document.getElementById("vizSimMoreFramesBtn");
    var frameReadout = document.getElementById("vizFrameReadout");
    var frameSlider = document.getElementById("vizFrameSlider");
    var frameInput = document.getElementById("vizFrameInput");
    var fpsSlider = document.getElementById("vizPlaybackFpsSlider");
    var fpsInput = document.getElementById("vizPlaybackFpsInput");
    var frameCount = getMoleculeFrameCount();
    var hasPlayback = frameCount > 1;
    var frameIndex = Math.max(0, moleculeState.frameIndex);
    var fps = Math.round(clampNumber(uiState.playback_fps, 1, 60, 12));

    uiState.playback_fps = fps;

    if (group) {
      group.hidden = !hasPlayback;
    }

    if (playButton) {
      playButton.disabled = !hasPlayback;
      playButton.textContent = moleculeState.playing ? "Pause" : "Play";
    }

    if (simMoreFramesButton) {
      var canSimMoreFrames =
        hasPlayback &&
        moleculeSceneMatchesCurrentJobSource() &&
        typeof window.canSimMoreFramesForCurrentJob === "function" &&
        window.canSimMoreFramesForCurrentJob();
      simMoreFramesButton.hidden = !canSimMoreFrames;
      simMoreFramesButton.disabled = !canSimMoreFrames;
      simMoreFramesButton.title = canSimMoreFrames
        ? "Submit another MD segment starting from the current simulation's final frame."
        : "Load a completed MD job to simulate more frames.";
    }

    if (frameReadout) {
      frameReadout.textContent = hasPlayback
        ? "Frame " + frameIndex + " / " + (frameCount - 1)
        : "Single frame";
    }

    if (frameSlider) {
      frameSlider.min = "0";
      frameSlider.max = String(Math.max(0, frameCount - 1));
      frameSlider.value = String(Math.min(frameIndex, Math.max(0, frameCount - 1)));
      frameSlider.disabled = !hasPlayback;
    }

    if (frameInput) {
      frameInput.min = "0";
      frameInput.max = String(Math.max(0, frameCount - 1));
      frameInput.value = String(Math.min(frameIndex, Math.max(0, frameCount - 1)));
      frameInput.disabled = !hasPlayback;
    }

    if (fpsSlider) {
      fpsSlider.value = String(fps);
      fpsSlider.disabled = !hasPlayback;
    }

    if (fpsInput) {
      fpsInput.value = String(fps);
      fpsInput.disabled = !hasPlayback;
    }
  }

  function getLegendAtomicNumbers() {
    if (moleculeState.scene && moleculeState.scene.atomicNumbers && moleculeState.scene.atomicNumbers.length) {
      var seen = {};
      var present = [];
      for (var i = 0; i < moleculeState.scene.atomicNumbers.length; ++i) {
        var atomicNumber = moleculeState.scene.atomicNumbers[i];
        if (seen[atomicNumber]) continue;
        seen[atomicNumber] = true;
        present.push(atomicNumber);
      }
      return present;
    }

    return Object.keys(ELEMENT_VISUALS)
      .map(function (key) {
        return Number(key);
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  function syncAtomLegendUi() {
    var legend = document.getElementById("vizAtomLegend");
    var list = document.getElementById("vizAtomLegendList");
    var selection = getEffectiveVizSelection();
    var showLegend = selectionShowsBallstick(selection);

    if (legend) {
      legend.hidden = !showLegend;
    }
    if (!showLegend || !list) return;

    var atomNumbers = getLegendAtomicNumbers();
    list.innerHTML = atomNumbers.map(function (atomicNumber) {
      var visual = getElementVisual(atomicNumber);
      return (
        '<div class="viz-legend-item">' +
          '<span class="viz-legend-swatch" style="background:' + toCssRgb(visual.color) + ';"></span>' +
          '<span class="viz-legend-label">' + getElementLabel(atomicNumber) + '</span>' +
        '</div>'
      );
    }).join("");
  }

  function syncModeUi() {
    var modeOptions = document.getElementById("vizModeOptions");
    var isoRadio = document.getElementById("vizModeIso");
    var volRadio = document.getElementById("vizModeVolume");
    var ballRadio = document.getElementById("vizModeBallstick");
    var groupVol = document.getElementById("vizGroupVolume");
    var groupIso = document.getElementById("vizGroupIso");
    var selection = getEffectiveVizSelection();
    var ballstickOnly = sceneRequiresBallstickOnly();

    if (modeOptions) {
      modeOptions.hidden = ballstickOnly;
    }

    if (isoRadio) {
      isoRadio.checked = !ballstickOnly && selection === "iso";
      isoRadio.disabled = ballstickOnly;
      isoRadio.title = ballstickOnly ? "This trajectory uses Ball & Stick only." : "";
    }
    if (volRadio) {
      volRadio.checked = !ballstickOnly && selectionShowsVolume(selection);
      volRadio.disabled = ballstickOnly;
      volRadio.title = ballstickOnly ? "This trajectory uses Ball & Stick only." : "";
    }
    if (ballRadio) {
      ballRadio.checked = ballstickOnly || selectionShowsBallstick(selection);
      ballRadio.title = ballstickOnly ? "This trajectory uses Ball & Stick only." : "";
    }

    if (groupVol) groupVol.style.display = !ballstickOnly && selectionShowsVolume(selection) ? "" : "none";
    if (groupIso) groupIso.style.display = !ballstickOnly && selection === "iso" ? "" : "none";

    syncBallstickAvailability();
    syncForceUi(selection);
    syncPlaybackUi();
    syncAtomLegendUi();
  }

  function setVisualizationMode(mode, options) {
    var opts = options || {};
    var nextSelection = normalizeVisualizationMode(mode);
    var wantsBallstick = selectionShowsBallstick(nextSelection);
    var needsCurrentJobScene = wantsBallstick && hasCurrentJobMoleculeSource() && !moleculeSceneMatchesCurrentJobSource();

    if (wantsBallstick && !opts.force && (!moleculeState.scene || needsCurrentJobScene)) {
      pendingBallstickSelection = nextSelection;
      syncModeUi();
      loadCurrentJobBallstickScene(nextSelection, {
        preserveCamera: !!opts.preserveBallstickCamera,
      })
        .then(function (loaded) {
          if (loaded || pendingBallstickSelection !== nextSelection) return loaded;
          if (hasCurrentJobMoleculeSource()) return false;

          return ensureDefaultBallstickScene().then(function (scene) {
            if (pendingBallstickSelection !== nextSelection) return false;
            window.loadMoleculeScene(scene, {
              autoEnterMode: true,
              preserveCamera: !!opts.preserveBallstickCamera,
              visualizationMode: nextSelection,
            });
            return true;
          });
        })
        .catch(function (err) {
          pendingBallstickSelection = "";
          syncModeUi();
          alert(err && err.message ? err.message : "Unable to load molecule scene.");
        });
      return false;
    }

    pendingBallstickSelection = "";
    currentVizSelection = nextSelection;

    syncCachedCameras();

    if (selectionUsesVolumeShader(nextSelection)) {
      lastVolumeMode = "volume";
      if (typeof originalSwitchRenderMode === "function" && renderMode !== "volume") {
        originalSwitchRenderMode("volume");
      }

      if (volumeCamera) {
        camera = volumeCamera;
      }

      if (selectionShowsBallstick(nextSelection)) {
        if (opts.preserveBallstickCamera && camera) {
          moleculeCamera = camera;
          moleculeState.newUpload = false;
        } else if (!camera && moleculeCamera) {
          camera = moleculeCamera;
          moleculeState.newUpload = false;
        }
      } else {
        moleculeState.playing = false;
      }

      samplingRate = 1.0;
      syncModeUi();
      return true;
    }

    moleculeState.playing = false;
    if (wantsBallstick) {
      if (opts.preserveBallstickCamera && camera) {
        moleculeState.newUpload = false;
        syncCachedCameras();
      } else if (!camera && moleculeCamera) {
        camera = moleculeCamera;
        moleculeState.newUpload = false;
      }
    }

    if (typeof originalSwitchRenderMode === "function" && renderMode !== "iso") {
      originalSwitchRenderMode("iso");
    }

    syncModeUi();
    return true;
  }

  window.setVisualizationMode = setVisualizationMode;

  function setMoleculeFrame(nextFrame, options) {
    var opts = options || {};
    var frameCount = getMoleculeFrameCount();
    if (!frameCount) return;

    var clamped = Math.max(0, Math.min(frameCount - 1, Math.trunc(Number(nextFrame) || 0)));
    if (clamped === moleculeState.frameIndex && !opts.force) {
      syncPlaybackUi();
      return;
    }

    moleculeState.frameIndex = clamped;
    rebuildMoleculeInstanceData();
    syncPlaybackUi();
  }

  function togglePlayback() {
    if (getMoleculeFrameCount() <= 1) return;
    moleculeState.playing = !moleculeState.playing;
    moleculeState.lastAdvanceAt = performance.now();
    syncPlaybackUi();
  }

  function seekPlaybackFrame(nextFrame) {
    moleculeState.playing = false;
    moleculeState.lastAdvanceAt = 0;
    setMoleculeFrame(nextFrame, { force: true });
  }

  function setPlaybackFps(nextFps) {
    uiState.playback_fps = Math.round(clampNumber(nextFps, 1, 60, 12));
    syncPlaybackUi();
  }

  function advancePlayback(now) {
    if (!moleculeState.playing) return;

    var frameCount = getMoleculeFrameCount();
    if (frameCount <= 1) {
      moleculeState.playing = false;
      syncPlaybackUi();
      return;
    }

    var fps = clampNumber(uiState.playback_fps, 1, 60, 12);
    var frameDuration = 1000.0 / fps;

    if (!moleculeState.lastAdvanceAt) {
      moleculeState.lastAdvanceAt = now;
      return;
    }

    if (now - moleculeState.lastAdvanceAt < frameDuration) return;

    var elapsed = now - moleculeState.lastAdvanceAt;
    var stepCount = Math.max(1, Math.floor(elapsed / frameDuration));
    moleculeState.lastAdvanceAt += stepCount * frameDuration;
    setMoleculeFrame((moleculeState.frameIndex + stepCount) % frameCount, { force: true });
  }

  function fitCameraToMolecule() {
    if (!moleculeState.scene) return;

    var scene = moleculeState.scene;
    var centerVec = vec3.set(vec3.create(), scene.center[0], scene.center[1], scene.center[2]);
    var eye = vec3.set(
      vec3.create(),
      scene.center[0],
      scene.center[1],
      scene.center[2] + Math.max(DEFAULT_FIT_MIN_DISTANCE, scene.radius * DEFAULT_FIT_DISTANCE_MULTIPLIER)
    );

    camera = new ArcballCamera(
      eye,
      centerVec,
      up,
      Math.max(DEFAULT_FIT_MIN_ORBIT_RADIUS, scene.radius * DEFAULT_FIT_ORBIT_RADIUS_MULTIPLIER),
      [Math.max(1, WIDTH), Math.max(1, HEIGHT)]
    );
    syncCachedCameras();
  }

  function renderMoleculeScene(options) {
    var opts = options || {};
    if (!moleculeState.scene || !moleculeShader || !gl) return;

    if (moleculeState.newUpload) {
      fitCameraToMolecule();
      moleculeState.newUpload = false;
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    if (opts.overlay) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
    } else {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    moleculeShader.use(gl);

    projView = mat4.create();
    projView = mat4.mul(projView, proj, camera.camera);
    if (moleculeShader.uniforms["proj_view"]) {
      gl.uniformMatrix4fv(moleculeShader.uniforms["proj_view"], false, projView);
    }

    var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];
    if (moleculeShader.uniforms["eye_pos"]) {
      gl.uniform3fv(moleculeShader.uniforms["eye_pos"], eye);
    }

    if (moleculeBondMesh && moleculeBondMesh.instanceCount > 0) {
      gl.bindVertexArray(moleculeBondMesh.vao);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        moleculeBondMesh.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        moleculeBondMesh.instanceCount
      );
    }

    if (moleculeAtomMesh && moleculeAtomMesh.instanceCount > 0) {
      gl.bindVertexArray(moleculeAtomMesh.vao);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        moleculeAtomMesh.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        moleculeAtomMesh.instanceCount
      );
    }

    if (moleculeForceShaftMesh && moleculeForceShaftMesh.instanceCount > 0) {
      gl.bindVertexArray(moleculeForceShaftMesh.vao);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        moleculeForceShaftMesh.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        moleculeForceShaftMesh.instanceCount
      );
    }

    if (moleculeForceHeadMesh && moleculeForceHeadMesh.instanceCount > 0) {
      gl.bindVertexArray(moleculeForceHeadMesh.vao);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        moleculeForceHeadMesh.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        moleculeForceHeadMesh.instanceCount
      );
    }

    gl.bindVertexArray(null);
  }

  var originalSwitchRenderMode = switchRenderMode;
  switchRenderMode = function (mode) {
    if (mode === "iso" || mode === "volume") {
      lastVolumeMode = mode;
    }

    originalSwitchRenderMode(mode);

    syncModeUi();
    return true;
  };

  resizeCanvasAndViewport = function () {
    if (!canvas || !gl) return;

    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var displayWidth = Math.floor(canvas.clientWidth * dpr);
    var displayHeight = Math.floor(canvas.clientHeight * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    WIDTH = canvas.width;
    HEIGHT = canvas.height;

    var near = 0.1;
    var far = 100.0;
    var selection = currentVizSelection;
    var showsVolume = selection === "iso" || selectionShowsVolume(selection);
    var showsBallstick = selectionShowsBallstick(selection) && moleculeState.scene;

    if (showsVolume && typeof window.getVolumeSceneMetrics === "function") {
      var volumeMetrics = window.getVolumeSceneMetrics();
      if (volumeMetrics && volumeMetrics.radius > 0) {
        near = Math.max(0.05, volumeMetrics.radius * 0.02);
        far = Math.max(100.0, volumeMetrics.radius * 12.0);
      }
    }

    if (showsBallstick) {
      near = Math.min(near, Math.max(0.02, moleculeState.scene.radius * 0.02));
      far = Math.max(far, Math.max(80.0, moleculeState.scene.radius * 24.0));
    }

    proj = mat4.perspective(mat4.create(), (60 * Math.PI) / 180.0, WIDTH / HEIGHT, near, far);

    if (camera && typeof camera.setBounds === "function") {
      camera.setBounds([WIDTH, HEIGHT]);
    }

    if (shader && shader.uniforms && shader.uniforms["screen_dims"]) {
      gl.useProgram(shader.program);
      gl.uniform2f(shader.uniforms["screen_dims"], WIDTH, HEIGHT);
    }
  };

  function bindSliderAndInput(key, sliderId, inputId, options) {
    var slider = document.getElementById(sliderId);
    var input = document.getElementById(inputId);
    if (!slider || !input) return;

    var min = Number(slider.min);
    var max = Number(slider.max);
    var onChange = options && typeof options.onChange === "function" ? options.onChange : function () {};

    function clampValue(value) {
      return clampNumber(value, min, max, min);
    }

    function snapToStep(value) {
      var step = Number(slider.step || 0);
      if (!(step > 0)) return value;
      var k = Math.round((value - min) / step);
      return min + k * step;
    }

    function format(value) {
      var stepText = String(slider.step || "");
      var dot = stepText.indexOf(".");
      var decimals = dot >= 0 ? stepText.length - dot - 1 : 0;
      return decimals > 0 ? Number(value).toFixed(decimals) : String(Math.round(value));
    }

    function applyValue(value, updateInput) {
      var next = snapToStep(clampValue(value));
      slider.value = String(next);
      if (updateInput) input.value = format(next);
      uiState[key] = Number(next);
      if (
        key === "dt_scale" ||
        key === "vol_alpha_lo" ||
        key === "vol_alpha_hi" ||
        key === "opacity_strength" ||
        key === "iso_value"
      ) {
        applyUniformsFromUI();
      }
      onChange(next);
    }

    applyValue(Number(slider.value), true);

    slider.addEventListener("input", function () {
      applyValue(Number(slider.value), true);
    });

    input.addEventListener("input", function () {
      if (input.value === "" || input.value === "-" || input.value === "." || input.value === "-.") return;
      var value = Number(input.value);
      if (!isFinite(value)) return;
      applyValue(value, false);
    });

    function commit() {
      applyValue(Number(input.value), true);
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", function (evt) {
      if (evt.key === "Enter") {
        evt.preventDefault();
        commit();
        input.blur();
      }
    });
  }

  initVizUI = function () {
    if (vizUiBound) {
      syncModeUi();
      return;
    }

    vizUiBound = true;

    var wrap = document.getElementById("vizCollapsible");
    var button = document.getElementById("vizToggleBtn");
    if (wrap && button) {
      button.addEventListener("click", function () {
        var collapsed = wrap.classList.toggle("is-collapsed");
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
    }

    var isoRadio = document.getElementById("vizModeIso");
    var volRadio = document.getElementById("vizModeVolume");
    var ballRadio = document.getElementById("vizModeBallstick");
    var forceToggle = document.getElementById("vizShowForces");

    if (isoRadio) {
      isoRadio.addEventListener("change", function () {
        if (isoRadio.checked) setVisualizationMode("iso");
      });
    }

    function applyCompositeSelection() {
      var wantsVolume = !!(volRadio && volRadio.checked);
      var wantsBallstick = !!(ballRadio && ballRadio.checked);
      var nextSelection = wantsVolume
        ? (wantsBallstick ? "volume_ballstick" : "volume")
        : (wantsBallstick ? "ballstick" : "iso");

      setVisualizationMode(nextSelection, {
        preserveBallstickCamera: true,
      });
    }

    if (volRadio) {
      volRadio.addEventListener("change", function () {
        applyCompositeSelection();
      });
    }

    if (ballRadio) {
      ballRadio.addEventListener("change", function () {
        applyCompositeSelection();
      });
    }

    if (forceToggle) {
      forceToggle.addEventListener("change", function () {
        uiState.show_forces = !!forceToggle.checked;
        rebuildMoleculeInstanceData();
        syncModeUi();
      });
    }

    bindSliderAndInput("dt_scale", "ui_quality", "ui_quality_in");
    bindSliderAndInput("vol_alpha_lo", "ui_alpha_start", "ui_alpha_start_in");
    bindSliderAndInput("vol_alpha_hi", "ui_alpha_end", "ui_alpha_end_in");
    bindSliderAndInput("opacity_strength", "ui_opacity", "ui_opacity_in");
    bindSliderAndInput("iso_value", "ui_isovalue", "ui_isovalue_in");

    var playbackToggle = document.getElementById("vizPlaybackToggleBtn");
    if (playbackToggle) {
      playbackToggle.addEventListener("click", function () {
        togglePlayback();
      });
    }

    var simMoreFramesButton = document.getElementById("vizSimMoreFramesBtn");
    if (simMoreFramesButton) {
      simMoreFramesButton.addEventListener("click", function () {
        if (typeof window.openCurrentMdContinuationModal !== "function") return;

        simMoreFramesButton.disabled = true;
        Promise.resolve(window.openCurrentMdContinuationModal())
          .catch(function (err) {
            alert("Sim more frames failed: " + ((err && err.message) || String(err)));
          })
          .finally(function () {
            syncPlaybackUi();
          });
      });
    }

    var frameSlider = document.getElementById("vizFrameSlider");
    var frameInput = document.getElementById("vizFrameInput");
    if (frameSlider) {
      frameSlider.addEventListener("input", function () {
        seekPlaybackFrame(frameSlider.value);
      });
    }
    if (frameInput) {
      frameInput.addEventListener("input", function () {
        seekPlaybackFrame(frameInput.value);
      });
    }

    var fpsSlider = document.getElementById("vizPlaybackFpsSlider");
    var fpsInput = document.getElementById("vizPlaybackFpsInput");
    if (fpsSlider) {
      fpsSlider.addEventListener("input", function () {
        setPlaybackFps(fpsSlider.value);
      });
    }
    if (fpsInput) {
      fpsInput.addEventListener("input", function () {
        setPlaybackFps(fpsInput.value);
      });
    }

    syncModeUi();
  };

  renderFrame = function () {
    if (document.hidden) return;
    if (!gl) return;

    resizeCanvasAndViewport();

    var startTime = performance.now();
    var selection = currentVizSelection;
    var renderVolumePass = selection === "iso" || selectionShowsVolume(selection);
    var renderBallstickPass = selectionShowsBallstick(selection) && !!moleculeState.scene;
    var didRenderVolume = false;

    if (renderBallstickPass) {
      advancePlayback(startTime);
    }

    if (renderVolumePass && shader) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.disable(gl.BLEND);

      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      if (newVolumeUpload) {
        if (renderBallstickPass && camera) {
          volumeCamera = camera;
        } else if (typeof window.fitCameraToVolume === "function") {
          window.fitCameraToVolume();
          syncCachedCameras();
        } else {
          camera = new ArcballCamera(defaultEye, center, up, 2, [WIDTH, HEIGHT]);
          syncCachedCameras();
        }
        samplingRate = 1.0;
      }

      shader.use(gl);

      if (shader.uniforms["dt_scale"]) gl.uniform1f(shader.uniforms["dt_scale"], getEffectiveDtScale());

      projView = mat4.create();
      projView = mat4.mul(projView, proj, camera.camera);
      if (shader.uniforms["proj_view"]) gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);

      var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];
      if (shader.uniforms["eye_pos"]) gl.uniform3fv(shader.uniforms["eye_pos"], eye);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, cubeStrip.length / 3);
      didRenderVolume = true;
    } else {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    if (renderBallstickPass) {
      renderMoleculeScene({
        overlay: didRenderVolume,
      });
    }

    var renderTime = performance.now() - startTime;
    var targetSamplingRate = renderTime / targetFrameTime;

    if (takeScreenShot) {
      takeScreenShot = false;
      canvas.toBlob(function (blob) {
        saveAs(blob, "screen.png");
      }, "image/png");
    }

    if (didRenderVolume && !newVolumeUpload && targetSamplingRate > samplingRate) {
      samplingRate = 0.8 * samplingRate + 0.2 * targetSamplingRate;
      if (shader.uniforms["dt_scale"]) gl.uniform1f(shader.uniforms["dt_scale"], getEffectiveDtScale());
    }

    newVolumeUpload = false;
  };

  var originalUploadVolumeToGPU = uploadVolumeToGPU;
  uploadVolumeToGPU = function (vol) {
    volumeCamera = null;
    originalUploadVolumeToGPU(vol);
    syncModeUi();
  };

  window.loadMoleculeScene = function (input, options) {
    var opts = options || {};
    var scene = normalizeMoleculeScene(input);
    if (!scene) {
      alert("Unable to load molecule scene.");
      return false;
    }

    if (!scene.label && opts.label) {
      scene.label = String(opts.label);
    }

    ensureMoleculeRenderer();

    moleculeState.scene = scene;
    moleculeState.sourceKey = typeof opts.sourceKey === "string" ? opts.sourceKey : "";
    moleculeState.frameIndex = 0;
    moleculeState.playing = false;
    moleculeState.lastAdvanceAt = 0;
    moleculeState.newUpload = true;

    rebuildMoleculeInstanceData();
    syncModeUi();
    if (typeof window.setViewContext === "function" && scene.label) {
      window.setViewContext(scene.label);
    }

    if (opts.autoEnterMode === false) {
      pendingBallstickSelection = "";
      syncModeUi();
    } else {
      setVisualizationMode(
        opts.visualizationMode || pendingBallstickSelection || "ballstick",
        {
          force: true,
          preserveBallstickCamera: !!opts.preserveCamera,
        }
      );
    }

    if (!renderLoopStarted) {
      renderLoopStarted = true;
      setInterval(renderFrame, targetFrameTime);
    }

    return true;
  };

  window.loadMoleculeSceneFromXml = function (xmlText, options) {
    var opts = options || {};
    if (!xmlText) {
      alert("Missing molecule scene XML.");
      return null;
    }

    var scene = parsePubChemXmlScene(xmlText, {
      label: opts.label || "Molecule",
    });
    return window.loadMoleculeScene(scene, {
      autoEnterMode: opts.autoEnterMode,
      label: opts.label,
      preserveCamera: opts.preserveCamera,
      sourceKey: typeof opts.sourceKey === "string" && opts.sourceKey ? opts.sourceKey : "inline_xml:" + xmlText,
      visualizationMode: opts.visualizationMode,
    });
  };

  window.loadMoleculeSceneFromUrl = function (url, options) {
    var opts = options || {};
    if (!url) {
      if (!opts.silentErrors) {
        alert("Missing molecule scene URL.");
      }
      return Promise.resolve(null);
    }

    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load molecule scene.");
        }
        var contentType = String(response.headers.get("content-type") || "").toLowerCase();
        var isXml = /\.xml(?:$|\?)/i.test(url) || contentType.indexOf("xml") >= 0;
        return isXml
          ? response.text().then(function (xmlText) {
              return parsePubChemXmlScene(xmlText, {
                label: opts.label || url.split("/").pop().replace(/\.xml$/i, "") || "Molecule",
              });
            })
          : response.json();
      })
      .then(function (data) {
        return window.loadMoleculeScene(data, {
          autoEnterMode: opts.autoEnterMode,
          label: opts.label,
          preserveCamera: opts.preserveCamera,
          sourceKey: typeof opts.sourceKey === "string" && opts.sourceKey ? opts.sourceKey : "url:" + url,
          visualizationMode: opts.visualizationMode,
        });
      })
      .catch(function (err) {
        if (!opts.silentErrors) {
          alert(err && err.message ? err.message : "Unable to load molecule scene.");
        }
        throw err;
      });
  };

  var previousOnload = window.onload;
  window.onload = function () {
    if (typeof previousOnload === "function") {
      previousOnload();
    }

    ensureMoleculeRenderer();
    syncModeUi();
  };
})();
