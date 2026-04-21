(function () {
  if (typeof window === "undefined") return;

  var lastVolumeMode = typeof renderMode === "string" && renderMode === "volume" ? "volume" : "iso";
  var vizUiBound = false;

  var moleculeShader = null;
  var moleculeAtomMesh = null;
  var moleculeBondMesh = null;

  var moleculeState = {
    scene: null,
    frameIndex: 0,
    playing: false,
    lastAdvanceAt: 0,
    newUpload: false,
  };
  var defaultBallstickScene = null;
  var defaultBallstickScenePromise = null;
  var DEFAULT_BALLSTICK_XML_URL = "/assets/Caffeine.xml";

  uiState.atom_scale = 0.58;
  uiState.bond_radius = 0.18;
  uiState.playback_fps = 12;

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

  var ELEMENT_VISUALS = {
    1: { color: [0.94, 0.94, 0.94], radius: 0.31 },
    5: { color: [1.0, 0.71, 0.71], radius: 0.84 },
    6: { color: [0.22, 0.22, 0.24], radius: 0.76 },
    7: { color: [0.19, 0.31, 0.97], radius: 0.71 },
    8: { color: [0.92, 0.18, 0.18], radius: 0.66 },
    9: { color: [0.56, 0.88, 0.31], radius: 0.57 },
    14: { color: [0.95, 0.78, 0.47], radius: 1.11 },
    15: { color: [1.0, 0.5, 0.0], radius: 1.07 },
    16: { color: [0.95, 0.9, 0.2], radius: 1.05 },
    17: { color: [0.12, 0.94, 0.12], radius: 1.02 },
    35: { color: [0.65, 0.16, 0.16], radius: 1.2 },
    53: { color: [0.58, 0.0, 0.58], radius: 1.39 },
  };

  function getElementVisual(atomicNumber) {
    return ELEMENT_VISUALS[atomicNumber] || { color: [0.62, 0.72, 0.82], radius: 0.9 };
  }

  function clampNumber(value, min, max, fallback) {
    var num = Number(value);
    if (!isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
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

  function normalizeFrames(input, atomCount) {
    var frames = input.frames || input.trajectory || input.snapshots;
    var normalized = [];

    if (Array.isArray(frames) && frames.length) {
      for (var i = 0; i < frames.length; ++i) {
        var frame = normalizeFrame(frames[i], atomCount);
        if (frame) normalized.push(frame);
      }
    }

    if (!normalized.length) {
      var single = normalizeFrame(input.positions || input.coordinates || input.xyz || input.atoms, atomCount);
      if (single) normalized.push(single);
    }

    return normalized;
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
      radii[i] = clampNumber(values[i], 0.15, 2.5, fallback);
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
      positions[i * 3 + 0] = xs[i];
      positions[i * 3 + 1] = ys[i];
      positions[i * 3 + 2] = zs[i];
    }

    return {
      label: opts.label || "Caffeine",
      atomicNumbers: orderedAtomicNumbers,
      positions: positions,
      bonds: [],
    };
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

        var cutoff = Math.max(0.45, 1.15 * (radii[i] + radii[j]));
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

  function normalizeMoleculeScene(input) {
    var scene = input && typeof input === "object" ? input : null;
    if (!scene) return null;

    if (scene.moleculeScene && typeof scene.moleculeScene === "object") {
      scene = scene.moleculeScene;
    } else if (scene.visualization && typeof scene.visualization === "object") {
      scene = scene.visualization;
    }

    var atomicNumbers = normalizeAtomicNumbers(scene);
    if (!atomicNumbers.length) return null;

    var frames = normalizeFrames(scene, atomicNumbers.length);
    if (!frames.length) return null;

    var atomColors = normalizeAtomColors(scene.atomColors || scene.colors, atomicNumbers);
    var atomRadii = normalizeAtomRadii(scene.atomRadii || scene.radii, atomicNumbers);
    var bonds = normalizeBondList(scene.bonds, atomicNumbers.length);

    if (!bonds.length && !Array.isArray(scene.bonds)) {
      bonds = inferBonds(atomicNumbers, frames[0], atomRadii);
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

    return {
      label: scene.label || scene.name || "",
      atomicNumbers: atomicNumbers,
      frames: frames,
      atomColors: atomColors,
      atomRadii: atomRadii,
      bonds: bonds,
      center: center,
      radius: radius,
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
  }

  function uploadInstanceData(mesh, modelData, colorData, instanceCount) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.modelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, modelData, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_DRAW);

    mesh.instanceCount = instanceCount;
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

  function rebuildMoleculeInstanceData() {
    if (!gl || !moleculeState.scene) return;
    ensureMoleculeRenderer();

    var scene = moleculeState.scene;
    var frame = scene.frames[moleculeState.frameIndex] || scene.frames[0];
    if (!frame) return;

    var atomCount = scene.atomicNumbers.length;
    var atomModels = new Float32Array(atomCount * 16);
    var atomColors = new Float32Array(atomCount * 3);

    for (var atomIndex = 0; atomIndex < atomCount; ++atomIndex) {
      var px = frame[atomIndex * 3 + 0];
      var py = frame[atomIndex * 3 + 1];
      var pz = frame[atomIndex * 3 + 2];
      var radius = Math.max(0.08, scene.atomRadii[atomIndex] * uiState.atom_scale);

      writeSphereMatrix(atomModels, atomIndex * 16, px, py, pz, radius);

      atomColors[atomIndex * 3 + 0] = scene.atomColors[atomIndex * 3 + 0];
      atomColors[atomIndex * 3 + 1] = scene.atomColors[atomIndex * 3 + 1];
      atomColors[atomIndex * 3 + 2] = scene.atomColors[atomIndex * 3 + 2];
    }

    uploadInstanceData(moleculeAtomMesh, atomModels, atomColors, atomCount);

    var maxBondCount = scene.bonds.length;
    var bondModels = new Float32Array(Math.max(1, maxBondCount) * 16);
    var bondColors = new Float32Array(Math.max(1, maxBondCount) * 3);
    var actualBondCount = 0;

    for (var bondIndex = 0; bondIndex < scene.bonds.length; ++bondIndex) {
      var bond = scene.bonds[bondIndex];
      var a = bond[0];
      var b = bond[1];
      var ok = writeCylinderMatrix(
        bondModels,
        actualBondCount * 16,
        frame[a * 3 + 0],
        frame[a * 3 + 1],
        frame[a * 3 + 2],
        frame[b * 3 + 0],
        frame[b * 3 + 1],
        frame[b * 3 + 2],
        clampNumber(uiState.bond_radius, 0.04, 0.5, 0.18)
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
      uploadInstanceData(moleculeBondMesh, new Float32Array(16), new Float32Array(3), 0);
      return;
    }

    uploadInstanceData(
      moleculeBondMesh,
      bondModels.subarray(0, actualBondCount * 16),
      bondColors.subarray(0, actualBondCount * 3),
      actualBondCount
    );
  }

  function getMoleculeFrameCount() {
    return moleculeState.scene ? moleculeState.scene.frames.length : 0;
  }

  function syncBallstickAvailability() {
    var radio = document.getElementById("vizModeBallstick");
    if (!radio) return;

    var hasScene = !!moleculeState.scene;
    radio.title = hasScene ? "" : "Load the Caffeine atom scene.";

    if (!hasScene && renderMode === "ballstick") {
      renderMode = lastVolumeMode;
    }
  }

  function syncPlaybackUi() {
    var frameWrap = document.getElementById("vizBallPlayback");
    var frameSlider = document.getElementById("ui_md_frame");
    var frameInput = document.getElementById("ui_md_frame_in");
    var frameLabel = document.getElementById("ui_md_frame_label");
    var playButton = document.getElementById("ui_md_play");
    var frameCount = getMoleculeFrameCount();
    var hasFrames = frameCount > 0;
    var hasAnimation = frameCount > 1;

    if (frameWrap) frameWrap.style.display = hasFrames ? "" : "none";

    if (frameSlider) {
      frameSlider.disabled = !hasAnimation;
      frameSlider.min = "0";
      frameSlider.max = String(Math.max(0, frameCount - 1));
      frameSlider.value = String(Math.min(moleculeState.frameIndex, Math.max(0, frameCount - 1)));
    }

    if (frameInput) {
      frameInput.disabled = !hasAnimation;
      frameInput.min = "1";
      frameInput.max = String(Math.max(1, frameCount));
      frameInput.value = String(frameCount ? moleculeState.frameIndex + 1 : 1);
    }

    if (frameLabel) {
      frameLabel.textContent = hasFrames
        ? "Frame " + (moleculeState.frameIndex + 1) + " / " + frameCount
        : "Frame 0 / 0";
    }

    if (playButton) {
      playButton.disabled = !hasAnimation;
      playButton.textContent = moleculeState.playing ? "Pause" : "Play";
    }
  }

  function syncModeUi() {
    var isoRadio = document.getElementById("vizModeIso");
    var volRadio = document.getElementById("vizModeVolume");
    var ballRadio = document.getElementById("vizModeBallstick");
    var groupVol = document.getElementById("vizGroupVolume");
    var groupIso = document.getElementById("vizGroupIso");
    var groupBall = document.getElementById("vizGroupBallstick");

    if (isoRadio) isoRadio.checked = renderMode === "iso";
    if (volRadio) volRadio.checked = renderMode === "volume";
    if (ballRadio) ballRadio.checked = renderMode === "ballstick";

    if (groupVol) groupVol.style.display = renderMode === "volume" ? "" : "none";
    if (groupIso) groupIso.style.display = renderMode === "iso" ? "" : "none";
    if (groupBall) groupBall.style.display = renderMode === "ballstick" ? "" : "none";

    syncBallstickAvailability();
    syncPlaybackUi();
  }

  function setVisualizationMode(mode, options) {
    var opts = options || {};

    if (mode === "ballstick") {
      if (!moleculeState.scene && !opts.force) {
        ensureDefaultBallstickScene()
          .then(function (scene) {
            var ballRadio = document.getElementById("vizModeBallstick");
            window.loadMoleculeScene(scene, {
              autoEnterMode: !ballRadio || ballRadio.checked,
            });
          })
          .catch(function (err) {
            syncModeUi();
            alert(err && err.message ? err.message : "Unable to load Caffeine.xml.");
          });
        return false;
      }
      renderMode = "ballstick";
      samplingRate = 1.0;
      syncModeUi();
      return true;
    }

    if (mode === "iso" || mode === "volume") {
      lastVolumeMode = mode;
      if (typeof switchRenderMode === "function") {
        switchRenderMode(mode);
      }
      syncModeUi();
      return true;
    }

    return false;
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
      scene.center[2] + Math.max(6.0, scene.radius * 3.2)
    );

    camera = new ArcballCamera(
      eye,
      centerVec,
      up,
      Math.max(2.0, scene.radius * 1.4),
      [Math.max(1, WIDTH), Math.max(1, HEIGHT)]
    );
  }

  function renderMoleculeScene() {
    if (!moleculeState.scene || !moleculeShader || !gl) return;

    if (moleculeState.newUpload) {
      fitCameraToMolecule();
      moleculeState.newUpload = false;
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

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

    gl.bindVertexArray(null);
  }

  var originalSwitchRenderMode = switchRenderMode;
  switchRenderMode = function (mode) {
    if (mode === "ballstick") {
      return setVisualizationMode("ballstick");
    }

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
    if (renderMode === "ballstick" && moleculeState.scene) {
      near = Math.max(0.02, moleculeState.scene.radius * 0.02);
      far = Math.max(80.0, moleculeState.scene.radius * 24.0);
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

    if (isoRadio) {
      isoRadio.addEventListener("change", function () {
        if (isoRadio.checked) setVisualizationMode("iso");
      });
    }

    if (volRadio) {
      volRadio.addEventListener("change", function () {
        if (volRadio.checked) setVisualizationMode("volume");
      });
    }

    if (ballRadio) {
      ballRadio.addEventListener("change", function () {
        if (ballRadio.checked) setVisualizationMode("ballstick");
      });
    }

    bindSliderAndInput("dt_scale", "ui_quality", "ui_quality_in");
    bindSliderAndInput("vol_alpha_lo", "ui_alpha_start", "ui_alpha_start_in");
    bindSliderAndInput("vol_alpha_hi", "ui_alpha_end", "ui_alpha_end_in");
    bindSliderAndInput("opacity_strength", "ui_opacity", "ui_opacity_in");
    bindSliderAndInput("iso_value", "ui_isovalue", "ui_isovalue_in");
    bindSliderAndInput("atom_scale", "ui_atom_scale", "ui_atom_scale_in", {
      onChange: rebuildMoleculeInstanceData,
    });
    bindSliderAndInput("bond_radius", "ui_bond_radius", "ui_bond_radius_in", {
      onChange: rebuildMoleculeInstanceData,
    });
    bindSliderAndInput("playback_fps", "ui_md_fps", "ui_md_fps_in");

    var frameSlider = document.getElementById("ui_md_frame");
    var frameInput = document.getElementById("ui_md_frame_in");
    var playButton = document.getElementById("ui_md_play");

    if (frameSlider) {
      frameSlider.addEventListener("input", function () {
        setMoleculeFrame(Number(frameSlider.value));
      });
    }

    if (frameInput) {
      frameInput.addEventListener("input", function () {
        if (frameInput.value === "" || frameInput.value === "-") return;
        var value = Math.trunc(Number(frameInput.value));
        if (!isFinite(value)) return;
        setMoleculeFrame(value - 1);
      });
    }

    if (playButton) {
      playButton.addEventListener("click", togglePlayback);
    }

    syncModeUi();
  };

  renderFrame = function () {
    if (document.hidden) return;
    if (!gl) return;

    resizeCanvasAndViewport();

    var startTime = performance.now();

    if (renderMode === "ballstick") {
      advancePlayback(startTime);
      renderMoleculeScene();

      if (takeScreenShot) {
        takeScreenShot = false;
        canvas.toBlob(function (blob) {
          saveAs(blob, "screen.png");
        }, "image/png");
      }
      return;
    }

    if (!shader) return;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.disable(gl.BLEND);

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (newVolumeUpload) {
      camera = new ArcballCamera(defaultEye, center, up, 2, [WIDTH, HEIGHT]);
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

    var renderTime = performance.now() - startTime;
    var targetSamplingRate = renderTime / targetFrameTime;

    if (takeScreenShot) {
      takeScreenShot = false;
      canvas.toBlob(function (blob) {
        saveAs(blob, "screen.png");
      }, "image/png");
    }

    if (!newVolumeUpload && targetSamplingRate > samplingRate) {
      samplingRate = 0.8 * samplingRate + 0.2 * targetSamplingRate;
      if (shader.uniforms["dt_scale"]) gl.uniform1f(shader.uniforms["dt_scale"], getEffectiveDtScale());
    }

    newVolumeUpload = false;
  };

  var originalUploadVolumeToGPU = uploadVolumeToGPU;
  uploadVolumeToGPU = function (vol) {
    originalUploadVolumeToGPU(vol);
    syncModeUi();
  };

  window.loadMoleculeScene = function (input, options) {
    var opts = options || {};
    var scene = normalizeMoleculeScene(input);
    if (!scene) {
      alert("Unable to load molecule scene.");
      return;
    }

    ensureMoleculeRenderer();

    moleculeState.scene = scene;
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
      syncModeUi();
    } else {
      setVisualizationMode("ballstick", { force: true });
    }

    if (!renderLoopStarted) {
      renderLoopStarted = true;
      setInterval(renderFrame, targetFrameTime);
    }
  };

  window.loadMoleculeSceneFromUrl = function (url) {
    if (!url) {
      alert("Missing molecule scene URL.");
      return;
    }

    fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load molecule scene.");
        }
        var contentType = String(response.headers.get("content-type") || "").toLowerCase();
        var isXml = /\.xml(?:$|\?)/i.test(url) || contentType.indexOf("xml") >= 0;
        return isXml
          ? response.text().then(function (xmlText) {
              return parsePubChemXmlScene(xmlText, {
                label: url.split("/").pop().replace(/\.xml$/i, "") || "Molecule",
              });
            })
          : response.json();
      })
      .then(function (data) {
        window.loadMoleculeScene(data);
      })
      .catch(function (err) {
        alert(err && err.message ? err.message : "Unable to load molecule scene.");
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
