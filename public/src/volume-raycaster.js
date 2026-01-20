// ------------------------------
// Volume renderer (WebGL2) - BIN (FP16) volume support
// Expects BIN layout:
//   int32 Nx, int32 Ny, int32 Nz, float32 voxelSize   (16 bytes, little-endian)
//   followed by Nx*Ny*Nz uint16 (FP16 raw density bits)
//
// Starts by loading: assets/density.bin
// Later, Jobs UI can call: window.loadDensityFromFirebaseUrl(url)
// ------------------------------

// ====== shaders assumed defined elsewhere ======
// var vertShader = `...`;
// var fragShaderVol = `...`;
// var fragShaderIso = `...`;

var cubeStrip = [
  1, 1, 0,
  0, 1, 0,
  1, 1, 1,
  0, 1, 1,
  0, 0, 1,
  0, 1, 0,
  0, 0, 0,
  1, 1, 0,
  1, 0, 0,
  1, 1, 1,
  1, 0, 1,
  0, 0, 1,
  1, 0, 0,
  0, 0, 0
];

var takeScreenShot = false;
var canvas = null;

var gl = null;
var shader = null;

var volumeTexture = null;
var colormapTex = null;

var proj = null;
var camera = null;
var projView = null;

var newVolumeUpload = true;
var targetFrameTime = 32;

var WIDTH = 640;
var HEIGHT = 480;

const defaultEye = vec3.set(vec3.create(), 0.5, 0.5, 1.5);
const center = vec3.set(vec3.create(), 0.5, 0.5, 0.5);
const up = vec3.set(vec3.create(), 0.0, 1.0, 0.0);

// ---- UI catalogs ----
var volumes = {
  "Density": "density.bin",
};

var colormaps = {
  "Cool Warm": "colormaps/cool-warm-paraview.png",
  "Matplotlib Plasma": "colormaps/matplotlib-plasma.png",
  "Matplotlib Virdis": "colormaps/matplotlib-virdis.png",
  "Rainbow": "colormaps/rainbow.png",
  "Samsel Linear Green": "colormaps/samsel-linear-green.png",
  "Samsel Linear YGB 1211G": "colormaps/samsel-linear-ygb-1211g.png",
};

// ---------- render mode + state ----------
var renderMode = "volume"; // "volume" | "iso"

// Adaptive sampling multiplier (ALWAYS ON)
var samplingRate = 1.0;

// UI state (only includes knobs you want user-editable)
var uiState = {
  // base dt_scale (quality); adaptive sampling multiplies this
  dt_scale: 1.0,

  // volume mapping
  rho_max: 0.02,
  log_alpha: 10.0,

  // volume alpha shaping
  vol_alpha_lo: 0.05,
  vol_alpha_hi: 0.35,
  opacity_strength: 1.0,

  // iso threshold
  iso_value: 0.001
};

// track last volume uniforms so shader switches re-apply cleanly
var lastVolumeDims = null;
var lastVolumeScale = null;

// GL objects we need to keep on shader swap
var vao = null;
var renderLoopStarted = false;

// ---------- helpers ----------
function getEffectiveDtScale() {
  // user sets base; adaptive sampling increases effective dt_scale to hit frame budget
  return Math.max(0.0001, uiState.dt_scale * samplingRate);
}

function setText(id, txt) {
  var el = document.getElementById(id);
  if (el) el.textContent = txt;
}

// ---- resize support for full-screen canvas ----
function resizeCanvasAndViewport() {
  if (!canvas || !gl) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const displayWidth = Math.floor(canvas.clientWidth * dpr);
  const displayHeight = Math.floor(canvas.clientHeight * dpr);

  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  WIDTH = canvas.width;
  HEIGHT = canvas.height;

  proj = mat4.perspective(mat4.create(), 60 * Math.PI / 180.0, WIDTH / HEIGHT, 0.1, 100);

  if (camera && typeof camera.setBounds === "function") {
    camera.setBounds([WIDTH, HEIGHT]);
  }

  if (shader && shader.uniforms && shader.uniforms["screen_dims"]) {
    gl.uniform2f(shader.uniforms["screen_dims"], WIDTH, HEIGHT);
  }
}

function applyUniformsFromUI() {
  if (!gl || !shader || !shader.uniforms) return;

  // shared between both shaders
  if (shader.uniforms["dt_scale"]) gl.uniform1f(shader.uniforms["dt_scale"], getEffectiveDtScale());

  // volume-only uniforms (only present in fragShaderVol)
  if (shader.uniforms["rho_max"]) gl.uniform1f(shader.uniforms["rho_max"], uiState.rho_max);
  if (shader.uniforms["log_alpha"]) gl.uniform1f(shader.uniforms["log_alpha"], uiState.log_alpha);
  if (shader.uniforms["uAlphaLo"]) gl.uniform1f(shader.uniforms["uAlphaLo"], uiState.vol_alpha_lo);
  if (shader.uniforms["uAlphaHi"]) gl.uniform1f(shader.uniforms["uAlphaHi"], uiState.vol_alpha_hi);
  if (shader.uniforms["uOpacityStrength"]) gl.uniform1f(shader.uniforms["uOpacityStrength"], uiState.opacity_strength);

  // iso-only uniform (only present in fragShaderIso)
  if (shader.uniforms["iso_value"]) gl.uniform1f(shader.uniforms["iso_value"], uiState.iso_value);
}

function bindCommonUniformsAfterProgramSwap() {
  if (!gl || !shader || !shader.uniforms) return;

  // samplers
  if (shader.uniforms["volume"]) gl.uniform1i(shader.uniforms["volume"], 0);
  if (shader.uniforms["colormap"]) gl.uniform1i(shader.uniforms["colormap"], 1);

  // dims/scale (if loaded)
  if (lastVolumeDims && shader.uniforms["volume_dims"]) gl.uniform3iv(shader.uniforms["volume_dims"], lastVolumeDims);
  if (lastVolumeScale && shader.uniforms["volume_scale"]) gl.uniform3fv(shader.uniforms["volume_scale"], lastVolumeScale);

  // screen dims
  if (shader.uniforms["screen_dims"]) gl.uniform2f(shader.uniforms["screen_dims"], WIDTH, HEIGHT);

  applyUniformsFromUI();
}

function switchRenderMode(mode) {
  if (!gl) return;
  if (mode !== "volume" && mode !== "iso") return;
  if (renderMode === mode) return;

  renderMode = mode;

  var frag = (renderMode === "volume") ? fragShaderVol : fragShaderIso;

  shader = new Shader(gl, vertShader, frag);
  shader.use(gl);

  // ensure VAO still bound
  if (vao) gl.bindVertexArray(vao);

  // ensure textures still bound
  if (volumeTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
  }
  if (colormapTex) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, colormapTex);
  }

  bindCommonUniformsAfterProgramSwap();

  // reset adaptive multiplier on mode switch (keeps it crisp initially)
  samplingRate = 1.0;
  if (shader.uniforms["dt_scale"]) gl.uniform1f(shader.uniforms["dt_scale"], getEffectiveDtScale());
}

// ---------- UI wiring (collapsible + sliders + mode radios) ----------
function initVizUI() {
  // Collapsible
  var wrap = document.getElementById("vizCollapsible");
  var btn = document.getElementById("vizToggleBtn");
  if (wrap && btn) {
    btn.addEventListener("click", function () {
      var collapsed = wrap.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  // Mode radios
  var rVol = document.getElementById("vizModeVolume");
  var rIso = document.getElementById("vizModeIso");
  var groupVol = document.getElementById("vizGroupVolume");
  var groupIso = document.getElementById("vizGroupIso");

  function setModeUI(mode) {
    if (groupVol) groupVol.style.display = (mode === "volume") ? "" : "none";
    if (groupIso) groupIso.style.display = (mode === "iso") ? "" : "none";
  }

  if (rVol) {
    rVol.addEventListener("change", function () {
      if (!rVol.checked) return;
      setModeUI("volume");
      switchRenderMode("volume");
    });
  }

  if (rIso) {
    rIso.addEventListener("change", function () {
      if (!rIso.checked) return;
      setModeUI("iso");
      switchRenderMode("iso");
    });
  }

  function bindSliderAndInput(key, sliderId, inputId) {
    var s = document.getElementById(sliderId);
    var n = document.getElementById(inputId);
    if (!s || !n) return;

    var min = Number(s.min);
    var max = Number(s.max);

    function clamp(v) {
      if (!isFinite(v)) return min;
      return Math.max(min, Math.min(max, v));
    }

    function snapToStep(v) {
      var step = Number(s.step || 0);
      if (!step || step <= 0) return v;
      var k = Math.round((v - min) / step);
      return min + k * step;
    }

    function stepDecimals() {
      var step = String(s.step || "");
      var dot = step.indexOf(".");
      return dot >= 0 ? (step.length - dot - 1) : 0;
    }

    function formatForBox(v) {
      var d = stepDecimals();
      return d > 0 ? Number(v).toFixed(d) : String(Number(v));
    }

    function applyValue(v, updateBox) {
      v = clamp(v);
      v = snapToStep(v);

      s.value = v;
      if (updateBox) n.value = formatForBox(v);

      uiState[key] = Number(v);
      applyUniformsFromUI();
    }

    // init
    applyValue(Number(s.value), true);

    // slider -> box (always)
    s.addEventListener("input", function () {
      applyValue(Number(s.value), true);
    });

    // box typing behavior:
    n.addEventListener("input", function () {
      var txt = n.value;
      if (txt === "" || txt === "-" || txt === "." || txt === "-.") return;

      var v = Number(txt);
      if (!isFinite(v)) return;

      applyValue(v, false);
    });

    function commit() {
      var v = Number(n.value);
      if (!isFinite(v)) v = Number(s.value);
      applyValue(v, true);
    }

    n.addEventListener("blur", commit);

    n.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        n.blur();
      }
    });
  }

  // Map intuitive UI -> internal uiState keys
  bindSliderAndInput("dt_scale", "ui_quality", "ui_quality_in");
  bindSliderAndInput("rho_max", "ui_density_scale", "ui_density_scale_in");
  bindSliderAndInput("log_alpha", "ui_log_contrast", "ui_log_contrast_in");
  bindSliderAndInput("vol_alpha_lo", "ui_alpha_start", "ui_alpha_start_in");
  bindSliderAndInput("vol_alpha_hi", "ui_alpha_end", "ui_alpha_end_in");
  bindSliderAndInput("opacity_strength", "ui_opacity", "ui_opacity_in");
  bindSliderAndInput("iso_value", "ui_isovalue", "ui_isovalue_in");

  setModeUI(renderMode);
}

// ---- BIN volume load from URL ----
function loadVolumeBinFromUrl(url, onload) {
  if (!url) {
    alert("Missing volume URL.");
    return;
  }

  var req = new XMLHttpRequest();
  var loadingProgressText = document.getElementById("loadingText");
  var loadingProgressBar = document.getElementById("loadingProgressBar");

  if (loadingProgressText) loadingProgressText.innerHTML = "Loading Volume";
  if (loadingProgressBar) loadingProgressBar.setAttribute("style", "width: 0%");

  req.open("GET", url, true);
  req.responseType = "arraybuffer";

  req.onprogress = function (evt) {
    var total = evt.total && evt.total > 0 ? evt.total : 1;
    var percent = (evt.loaded / total) * 100;
    if (loadingProgressBar) {
      loadingProgressBar.setAttribute("style", "width: " + percent.toFixed(2) + "%");
    }
  };

  req.onerror = function () {
    if (loadingProgressText) loadingProgressText.innerHTML = "Error Loading Volume";
    if (loadingProgressBar) loadingProgressBar.setAttribute("style", "width: 0%");
  };

  req.onload = function () {
    var dataBuffer = req.response;
    if (!dataBuffer) {
      alert("Unable to load buffer properly from volume");
      return;
    }

    if (dataBuffer.byteLength < 16) {
      alert("Volume file too small (missing header).");
      return;
    }

    var dv = new DataView(dataBuffer);
    var Nx = dv.getInt32(0, true);
    var Ny = dv.getInt32(4, true);
    var Nz = dv.getInt32(8, true);
    var voxelSize = dv.getFloat32(12, true);

    if (!(Nx > 0 && Ny > 0 && Nz > 0)) {
      alert("Invalid volume dims: " + Nx + "x" + Ny + "x" + Nz);
      return;
    }

    var voxelCount = Nx * Ny * Nz;
    var expectedBytes = 16 + voxelCount * 2;
    if (dataBuffer.byteLength < expectedBytes) {
      alert("Volume file too small.");
      return;
    }

    var payload = new Uint16Array(dataBuffer, 16, voxelCount);

    if (loadingProgressText) loadingProgressText.innerHTML = "Loaded Volume";
    if (loadingProgressBar) loadingProgressBar.setAttribute("style", "width: 100%");

    onload({
      dims: [Nx, Ny, Nz],
      voxelSize: voxelSize,
      dataU16: payload
    });
  };

  req.send();
}

// ---- upload parsed volume to GL (shared by asset load + firebase load) ----
function uploadVolumeToGPU(vol) {
  if (!gl || !shader) {
    alert("WebGL not initialized yet.");
    return;
  }

  var volDims = vol.dims;

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  var tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, tex);

  gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F, volDims[0], volDims[1], volDims[2]);

  var halfFloatLinearOK = !!gl.getExtension("OES_texture_half_float_linear");

  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, halfFloatLinearOK ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, halfFloatLinearOK ? gl.LINEAR : gl.NEAREST);

  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.texSubImage3D(
    gl.TEXTURE_3D, 0,
    0, 0, 0,
    volDims[0], volDims[1], volDims[2],
    gl.RED, gl.HALF_FLOAT,
    vol.dataU16
  );

  var longestAxis = Math.max(volDims[0], Math.max(volDims[1], volDims[2]));
  var volScale = [volDims[0] / longestAxis, volDims[1] / longestAxis, volDims[2] / longestAxis];

  lastVolumeDims = volDims;
  lastVolumeScale = volScale;

  if (shader.uniforms["volume_dims"]) gl.uniform3iv(shader.uniforms["volume_dims"], volDims);
  if (shader.uniforms["volume_scale"]) gl.uniform3fv(shader.uniforms["volume_scale"], volScale);

  newVolumeUpload = true;

  if (volumeTexture) gl.deleteTexture(volumeTexture);
  volumeTexture = tex;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, volumeTexture);

  if (!renderLoopStarted) {
    renderLoopStarted = true;
    setInterval(renderFrame, targetFrameTime);
  }
}

// ---- called by HTML button / auto ----
var selectVolume = function () {
  if (!gl || !shader) {
    alert("WebGL not initialized yet.");
    return;
  }

  var file = volumes["Density"];
  var url = "assets/" + file;

  loadVolumeBinFromUrl(url, function (vol) {
    uploadVolumeToGPU(vol);
  });
};

// ---- Public hook for Jobs UI ----
// Usage: window.loadDensityFromFirebaseUrl(downloadUrl);
window.loadDensityFromFirebaseUrl = function (url) {
  loadVolumeBinFromUrl(url, function (vol) {
    uploadVolumeToGPU(vol);
  });
};

function renderFrame() {
  if (document.hidden) return;
  if (!gl || !shader) return;

  resizeCanvasAndViewport();

  var startTime = performance.now();

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (newVolumeUpload) {
    camera = new ArcballCamera(defaultEye, center, up, 2, [WIDTH, HEIGHT]);
    samplingRate = 1.0;
  }

  // keep dt_scale updated each frame (adaptive)
  if (shader.uniforms["dt_scale"]) gl.uniform1f(shader.uniforms["dt_scale"], getEffectiveDtScale());

  projView = mat4.create();
  projView = mat4.mul(projView, proj, camera.camera);
  if (shader.uniforms["proj_view"]) gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);

  var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];
  if (shader.uniforms["eye_pos"]) gl.uniform3fv(shader.uniforms["eye_pos"], eye);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, cubeStrip.length / 3);
  gl.finish();

  var endTime = performance.now();
  var renderTime = endTime - startTime;

  // adaptive sampling: if frame is slower than target, increase samplingRate (bigger steps)
  var targetSamplingRate = renderTime / targetFrameTime;

  if (takeScreenShot) {
    takeScreenShot = false;
    canvas.toBlob(function (b) { saveAs(b, "screen.png"); }, "image/png");
  }

  if (!newVolumeUpload && targetSamplingRate > samplingRate) {
    samplingRate = 0.8 * samplingRate + 0.2 * targetSamplingRate;
    if (shader.uniforms["dt_scale"]) gl.uniform1f(shader.uniforms["dt_scale"], getEffectiveDtScale());
  }

  newVolumeUpload = false;
}

var selectColormap = function () {
  var selector = document.getElementById("colormapList");
  if (!selector) return;

  var selection = selector.value;
  var path = colormaps[selection];
  if (!path) return;

  var colormapImage = new Image();
  colormapImage.onload = function () {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, colormapTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 180, 1, gl.RGBA, gl.UNSIGNED_BYTE, colormapImage);
  };
  colormapImage.src = path;
};

window.onload = function () {
  canvas = document.getElementById("glcanvas");
  gl = canvas.getContext("webgl2");
  if (!gl) {
    alert("Unable to initialize WebGL2. Your browser may not support it");
    return;
  }

  // start in volume mode
  shader = new Shader(gl, vertShader, fragShaderVol);
  shader.use(gl);

  // Setup required OpenGL state
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);
  gl.disable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // Setup VAO/VBO
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubeStrip), gl.STATIC_DRAW);

  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  // Init camera with placeholder bounds; resize() fixes it
  camera = new ArcballCamera(defaultEye, center, up, 2, [1, 1]);
  projView = mat4.create();

  resizeCanvasAndViewport();
  window.addEventListener("resize", resizeCanvasAndViewport, { passive: true });

  // Register input
  var controller = new Controller();
  controller.mousemove = function (prev, cur, evt) {
    if (evt.buttons == 1) {
      camera.rotate(prev, cur);
    } else if (evt.buttons == 2) {
      camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
    }
  };
  controller.wheel = function (amt) { camera.zoom(amt); };
  controller.pinch = controller.wheel;
  controller.twoFingerDrag = function (drag) { camera.pan(drag); };

  document.addEventListener("keydown", function (evt) {
    if (evt.key == "p") takeScreenShot = true;
  });

  controller.registerForCanvas(canvas);

  // Wire up HTML UI
  initVizUI();

  // Load default colormap into a persistent texture object
  var colormapImage = new Image();
  colormapImage.onload = function () {
    colormapTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, colormapTex);

    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, 180, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 180, 1, gl.RGBA, gl.UNSIGNED_BYTE, colormapImage);

    // set sampler units + any UI-driven uniforms
    bindCommonUniformsAfterProgramSwap();

    // Auto-load assets/density.bin once
    selectVolume();
  };
  colormapImage.src = colormaps["Cool Warm"];
};
