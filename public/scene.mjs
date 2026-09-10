// Native WebGL renderer: no remote libraries, assets, or game authority.
// All prices, ownership and moves arrive from the existing game engine.
export function scenePosition(index) {
  const i = ((index % 40) + 40) % 40;
  if (i <= 10) return [5 - i, 5];
  if (i <= 20) return [-5, 15 - i];
  if (i <= 30) return [i - 25, -5];
  return [5, i - 35];
}
export function sceneMotionPath(event) {
  if (event.kind !== "walk") return [event.to];
  return Array.from(
    { length: Math.min(80, Math.max(0, event.steps || 0)) },
    (_, i) => (event.from + i + 1) % 40,
  );
}
export function sceneInward(index) {
  const i = ((index % 40) + 40) % 40;
  if (i % 10 === 0) {
    const [x, z] = scenePosition(i),
      d = Math.hypot(x, z);
    return [-x / d, -z / d];
  }
  return i < 10 ? [0, -1] : i < 20 ? [1, 0] : i < 30 ? [0, 1] : [-1, 0];
}
export function sceneLabelAngle(index) {
  const i = ((index % 40) + 40) % 40;
  if (i % 10 === 0) return Math.PI / 4;
  const [dx, dz] = sceneInward(i);
  return Math.atan2(dx, dz);
}
export function sceneTileSize(index) {
  return ((index % 10) + 10) % 10 === 0 ? [1.12, 1.12] : [0.84, 1.18];
}
export function scenePawnPosition(index) {
  const [x, z] = scenePosition(index),
    [dx, dz] = sceneInward(index);
  return [x - dx * 0.34, z - dz * 0.34];
}
export function sceneBuildingKind(t) {
  return t.type === "property" && t.owner
    ? ["house", "shop", "office", "tower"][Math.min(3, Math.max(0, t.level || 0))]
    : null;
}
const DICE_PIPS = Object.freeze({
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
});
export function sceneDicePips(value) {
  return DICE_PIPS[Math.max(1, Math.min(6, Number(value) || 1))].map((p) => [...p]);
}
export function sceneDiceStage(elapsed, reduceMotion = false) {
  const ms = Math.max(0, Number(elapsed) || 0);
  if (reduceMotion) return ms < 450 ? "values" : ms < 1050 ? "sum" : "done";
  return ms < 900 ? "rolling" : ms < 1500 ? "values" : ms < 2250 ? "sum" : "done";
}
export function createBoardScene({ onSelect, onModeChange, onError } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "world-canvas";
  canvas.setAttribute(
    "aria-label",
    "Объёмное поле Kentopoly. Перетащи для поворота; выбери клетку нажатием или через список.",
  );
  canvas.tabIndex = 0;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl)
    throw Error(
      "WebGL недоступен. Включи аппаратное ускорение браузера или открой игру на устройстве с WebGL.",
    );
  canvas.dataset.renderer = "webgl";
  const norm = (v) => {
    const d = Math.hypot(...v) || 1;
    return v.map((x) => x / d);
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const mult = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const look = (eye, target) => {
    const z = norm(eye.map((v, i) => v - target[i])),
      x = norm(cross([0, 1, 0], z)),
      y = cross(z, x);
    return new Float32Array([
      x[0],
      y[0],
      z[0],
      0,
      x[1],
      y[1],
      z[1],
      0,
      x[2],
      y[2],
      z[2],
      0,
      -dot(x, eye),
      -dot(y, eye),
      -dot(z, eye),
      1,
    ]);
  };
  const perspective = (fov, aspect) => {
    const f = 1 / Math.tan(fov / 2),
      n = 0.1,
      far = 100;
    return new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + n) / (n - far),
      -1,
      0,
      0,
      (2 * far * n) / (n - far),
      0,
    ]);
  };
  const model = (x, y, z, sx, sy, sz, angle = 0) => {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1]);
  };
  const color = (hex) => {
    let h = hex.replace("#", "");
    if (h.length === 3)
      h = h
        .split("")
        .map((x) => x + x)
        .join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  };
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  const vertex = shader(
    gl.VERTEX_SHADER,
    `attribute vec3 position;attribute vec3 normal;attribute vec2 uv;uniform mat4 vp;uniform mat4 model;varying vec3 n;varying vec3 world;varying vec2 texcoord;void main(){vec4 p=model*vec4(position,1.);world=p.xyz;n=normalize(mat3(model)*normal);texcoord=uv;gl_Position=vp*p;}`,
  );
  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `precision mediump float;uniform vec3 tint;uniform sampler2D tex;uniform float textured;uniform float unlit;uniform vec3 eye;varying vec3 n;varying vec3 world;varying vec2 texcoord;void main(){vec4 t=texture2D(tex,texcoord);if(textured>.5&&t.a<.04)discard;vec3 c=mix(tint,t.rgb,textured);vec3 nn=normalize(n);vec3 light=normalize(vec3(-.6,1.,.8));float diff=max(dot(nn,light),0.);vec3 h=normalize(light+normalize(eye-world));float spec=pow(max(dot(nn,h),0.),40.)*.18*(1.-textured);float shade=mix(.53+.47*diff,1.,unlit);gl_FragColor=vec4(c*shade+spec,mix(1.,t.a,textured));}`,
  );
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error("Не удалось создать 3D-программу");
  gl.useProgram(program);
  const loc = {};
  for (const k of ["vp", "model", "tint", "tex", "textured", "unlit", "eye"])
    loc[k] = gl.getUniformLocation(program, k);
  const attrs = ["position", "normal", "uv"].map((k) => gl.getAttribLocation(program, k));
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(loc.tex, 0);
  const resources = { buffers: [], textures: [] };
  function mesh(verts) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    resources.buffers.push(buffer);
    return { buffer, count: verts.length / 8 };
  }
  function quad(
    out,
    a,
    b,
    c,
    d,
    n,
    uvs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ) {
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...[a, b, c, d][i], ...n, ...uvs[i]);
  }
  const b = [];
  quad(b, [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5], [0, 0, 1]);
  quad(b, [0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5], [0, 0, -1]);
  quad(b, [0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [1, 0, 0]);
  quad(b, [-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5], [-1, 0, 0]);
  quad(b, [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5], [0, 1, 0]);
  quad(b, [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, -1, 0]);
  const box = mesh(b);
  const pl = [];
  quad(pl, [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5], [0, 1, 0]);
  const plane = mesh(pl);
  function lathe(profile, segments = 24) {
    const a = [];
    for (let j = 0; j < profile.length - 1; j++) {
      const [r0, y0] = profile[j],
        [r1, y1] = profile[j + 1];
      for (let i = 0; i < segments; i++) {
        const q0 = (i / segments) * Math.PI * 2,
          q1 = ((i + 1) / segments) * Math.PI * 2;
        const points = [
          [r0 * Math.cos(q0), y0, r0 * Math.sin(q0)],
          [r0 * Math.cos(q1), y0, r0 * Math.sin(q1)],
          [r1 * Math.cos(q1), y1, r1 * Math.sin(q1)],
          [r1 * Math.cos(q0), y1, r1 * Math.sin(q0)],
        ];
        for (const ix of [0, 1, 2, 0, 2, 3]) {
          const q = ix === 0 || ix === 3 ? q0 : q1;
          const n = norm([Math.cos(q) * (y1 - y0), r0 - r1, Math.sin(q) * (y1 - y0)]);
          a.push(...points[ix], ...n, 0, 0);
        }
      }
    }
    return mesh(a);
  }
  const cylinder = lathe([
    [0, 0],
    [0.5, 0],
    [0.5, 1],
    [0, 1],
  ]);
  const cone = lathe([
    [0, 0],
    [0.5, 0],
    [0.1, 1],
    [0, 1],
  ]);
  const sphere = lathe(
    Array.from({ length: 15 }, (_, i) => [
      Math.sin((i / 14) * Math.PI) * 0.5,
      (1 - Math.cos((i / 14) * Math.PI)) * 0.5,
    ]),
  );
  const pawn = lathe([
    [0, 0],
    [0.24, 0],
    [0.27, 0.06],
    [0.26, 0.14],
    [0.17, 0.21],
    [0.1, 0.49],
    [0.15, 0.54],
    [0.2, 0.6],
    [0.22, 0.72],
    [0.16, 0.83],
    [0, 0.87],
  ]);
  const angularPawn = lathe(
    [
      [0, 0],
      [0.25, 0],
      [0.25, 0.12],
      [0.16, 0.2],
      [0.1, 0.49],
      [0.2, 0.58],
      [0.21, 0.74],
      [0.12, 0.84],
      [0, 0.84],
    ],
    6,
  );
  const ring = lathe(
    [
      [0.44, 0],
      [0.5, 0],
      [0.5, 0.035],
      [0.44, 0.035],
      [0.44, 0],
    ],
    32,
  );
  const cup = lathe(
    [
      [0, 0],
      [0.09, 0],
      [0.12, 0.11],
      [0.27, 0.37],
      [0.26, 0.42],
      [0.21, 0.42],
      [0.15, 0.26],
      [0, 0.24],
    ],
    24,
  );
  const bowl = lathe(
    [
      [0, 0],
      [0.45, 0],
      [0.5, 0.12],
      [0.48, 0.19],
      [0.4, 0.19],
      [0.34, 0.1],
      [0, 0.1],
    ],
    28,
  );
  let white = gl.createTexture();
  resources.textures.push(white);
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  function texture(draw, size = 256) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    draw(ctx, size);
    const t = gl.createTexture();
    resources.textures.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (anisotropy)
      gl.texParameterf(
        gl.TEXTURE_2D,
        anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)),
      );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  const centerTexture = texture((c, n) => {
    c.fillStyle = "#159b72";
    c.fillRect(0, 0, n, n);
    c.strokeStyle = "#ffffff0b";
    c.lineWidth = 1;
    for (let x = 0; x < n; x += 32) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, n);
      c.stroke();
      c.beginPath();
      c.moveTo(0, x);
      c.lineTo(n, x);
      c.stroke();
    }
    c.strokeStyle = "#d9c48260";
    c.lineWidth = 3;
    c.strokeRect(35, 35, n - 70, n - 70);
    c.textAlign = "center";
    c.fillStyle = "#c7d9ca";
    c.font = "500 23px Arial";
    c.fillText("Д Р У Ж Е С К И Й  К А П И Т А Л", n * 0.5, n * 0.1);
    c.fillStyle = "#fff1a7";
    c.font = "bold 88px Arial";
    c.fillText("KENTOPOLY", n * 0.5, n * 0.2);
    c.fillStyle = "#c5ded5";
    c.font = "23px Arial";
    c.fillText("4 ФОНТАНА  /  4 МОНОПОЛИИ", n * 0.5, n * 0.3);
    c.font = "18px Arial";
    c.fillStyle = "#acd0c1";
  }, 1024);
  let snapshot = null,
    me = null,
    selected = -1,
    roomKey = null,
    tilesTextures = [],
    tileSignature = "",
    motionSeq = 0,
    rollSeq = 0,
    queue = [],
    playing = null,
    diceAnimation = null,
    pawnPositions = new Map(),
    lastFrame = 0,
    raf = 0,
    disposed = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let follow = !reduced.matches,
    azimuth = Math.PI / 4,
    pitch = 0.88,
    zoom = 1,
    target = [0, 0, 0],
    cameraTarget = [0, 0, 0],
    cameraRadius = 25,
    eye = [12, 17, 12],
    vp = null,
    width = 1,
    height = 1,
    lastMode = "",
    finishAt = -Infinity,
    lastMovingId = null,
    drawCount = 0;
  const BANK_COLORS = {
    sber: "#39c87c",
    tbank: "#f1ce48",
    alfa: "#f05b63",
    vtb: "#50b3ec",
    psb: "#f39349",
    gpb: "#9b93e6",
    sov: "#bb86d8",
    raif: "#dce775",
  };
  function setMode() {
    const mode = follow ? "follow" : "overview";
    canvas.dataset.cameraMode = mode;
    onModeChange?.(mode);
  }
  function tileTexture(t) {
    return texture((c, n) => {
      c.clearRect(0, 0, n, n);
      c.fillStyle = "#173954";
      c.textAlign = "center";
      const aliases = {
          start: "НАЧАЛО",
          jail: "ТЮРЬМА",
          search: "ПОИСК",
          award: "2026 AWARDS",
          fountain: "ФОНТАН",
          rest: "ПЕРЕДЫШКА",
        },
        name = aliases[t.type] || t.name;
      let lines = [],
        line = "";
      c.font = "bold 42px Arial";
      for (const word of name.split(" ")) {
        const trial = line ? line + " " + word : word;
        if (c.measureText(trial).width > 242 && line) {
          lines.push(line);
          line = word;
        } else line = trial;
      }
      lines.push(line);
      lines.slice(0, 3).forEach((txt, i) => {
        while (c.measureText(txt).width > 244) txt = txt.slice(0, -2) + "…";
        c.fillText(txt, 128, 56 + i * 47);
      });
      c.font = "bold 36px Arial";
      c.fillStyle = "#215574";
      c.fillText(
        t.price
          ? "$" + t.price / 1000 + "K"
          : t.type === "start"
            ? "+$150K"
            : t.tax
              ? "−$" + t.tax / 1000 + "K"
              : "",
        128,
        218,
      );
    });
  }
  function update(s, playerId, sel) {
    snapshot = s;
    me = playerId;
    selected = sel;
    const key = s.id + ":" + s.seed + ":" + (s.layoutVersion || 0);
    const fresh = roomKey !== key;
    const sig = s.tiles.map((t) => t.name).join("|");
    if (sig !== tileSignature) {
      for (const t of tilesTextures) {
        gl.deleteTexture(t);
        resources.textures = resources.textures.filter((x) => x !== t);
      }
      tilesTextures = s.tiles.map(tileTexture);
      tileSignature = sig;
    }
    if (fresh) {
      roomKey = key;
      queue = [];
      playing = null;
      diceAnimation = null;
      motionSeq = s.motions?.at(-1)?.seq || 0;
      rollSeq = s.lastRoll?.seq || s.rollSeq || 0;
      pawnPositions = new Map(
        s.players.map((p) => [
          p.id,
          { pos: p.pos, x: scenePawnPosition(p.pos)[0], z: scenePawnPosition(p.pos)[1], hop: 0 },
        ]),
      );
      cameraTarget = [0, 0, 0];
      target = [0, 0, 0];
      zoom = 1;
      azimuth = Math.PI / 4;
      finishAt = -Infinity;
    }
    if (!fresh) {
      const roll = s.lastRoll;
      if (roll?.seq > rollSeq && Array.isArray(roll.dice) && roll.dice.length === 2) {
        rollSeq = roll.seq;
        diceAnimation = {
          seq: roll.seq,
          playerId: roll.playerId,
          dice: roll.dice.map((n) => Math.max(1, Math.min(6, Number(n) || 1))),
          total: Number(roll.total) || Number(roll.dice[0]) + Number(roll.dice[1]),
          started: performance.now(),
          stage: "",
        };
      }
      const newEvents = (s.motions || []).filter((e) => e.seq > motionSeq);
      if (newEvents.length && newEvents[0].seq > motionSeq + 1) {
        queue = [];
        playing = null;
        motionSeq = newEvents.at(-1).seq;
        newEvents.length = 0;
      }
      for (const e of newEvents) {
        motionSeq = e.seq;
        for (const to of sceneMotionPath(e)) queue.push({ id: e.playerId, to, kind: e.kind });
      }
      if (queue.length > 80) {
        queue = [];
        playing = null;
      }
      for (const p of s.players) {
        if (!pawnPositions.has(p.id) || (!playing && !queue.length)) {
          const [x, z] = scenePawnPosition(p.pos);
          pawnPositions.set(p.id, { pos: p.pos, x, z, hop: 0 });
        }
      }
    }
    if (reduced.matches) {
      queue = [];
      playing = null;
      for (const p of s.players) {
        const [x, z] = scenePawnPosition(p.pos);
        pawnPositions.set(p.id, { pos: p.pos, x, z, hop: 0 });
      }
    }
    canvas.dataset.motionSeq = String(motionSeq);
    canvas.dataset.rollSeq = String(rollSeq);
    setMode();
  }
  function project(x, y, z) {
    if (!vp) return null;
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (w <= 0) return null;
    return [
      (((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w) * width) / 2 + width / 2,
      ((-(vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) * height) / 2 + height / 2,
      (vp[2] * x + vp[6] * y + vp[10] * z + vp[14]) / w,
    ];
  }
  function inside(pt, poly) {
    if (poly.some((p) => !p)) return false;
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        v = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
      if (Math.abs(v) < 0.001) continue;
      if (sign && Math.sign(v) !== sign) return false;
      sign = Math.sign(v);
    }
    return true;
  }
  function pick(cx, cy) {
    let best = null;
    for (let i = 0; i < 40; i++) {
      const [x, z] = scenePosition(i),
        [tileW, tileD] = sceneTileSize(i),
        corner = i % 10 === 0,
        inward = corner ? [0, 1] : sceneInward(i),
        tangent = corner ? [1, 0] : [inward[1], -inward[0]],
        poly = [
          [-tileW / 2, -tileD / 2],
          [tileW / 2, -tileD / 2],
          [tileW / 2, tileD / 2],
          [-tileW / 2, tileD / 2],
        ].map(([a, b]) => project(x + tangent[0] * a + inward[0] * b, 0.32, z + tangent[1] * a + inward[1] * b));
      if (inside([cx, cy], poly)) {
        const d = project(x, 0.32, z)[2];
        if (!best || d < best.depth) best = { id: i, depth: d };
      }
    }
    return best?.id ?? null;
  }
  let historyOffset = 0,
    chronicleKey = "";
  function logPosition() {
    const el = document.querySelector("#board-chronicle");
    if (!el || !snapshot) return;
    const poly = [
      [-3.85, -3.85],
      [3.85, -3.85],
      [3.85, 3.85],
      [-3.85, 3.85],
    ].map(([x, z]) => project(x, 0.34, z));
    if (poly.some((p) => !p)) return;
    const x0 = Math.min(...poly.map((p) => p[0])),
      x1 = Math.max(...poly.map((p) => p[0])),
      y0 = Math.min(...poly.map((p) => p[1])),
      y1 = Math.max(...poly.map((p) => p[1]));
    let best = null;
    for (const [w, h] of width > 850
      ? [
          [300, 126],
          [250, 106],
          [200, 86],
          [160, 66],
        ]
      : [
          [190, 86],
          [150, 66],
          [120, 50],
          [94, 44],
        ]) {
      for (let x = x0; x < x1 - w; x += 10)
        for (let y = y0; y < y1 - h; y += 10) {
          if (y < 100 || y + h > height - (width < 700 ? 250 : 80)) continue;
          if (
            [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ].every((p) => inside(p, poly))
          ) {
            const score =
              -Math.pow(x + w / 2 - (x0 + x1) / 2 - (x1 - x0) * 0.08, 2) -
              Math.pow(y + h / 2 - (y0 + y1) / 2 - (y1 - y0) * 0.17, 2);
            if (!best || score > best.score) best = { x, y, w, h, score };
          }
        }
      if (best) break;
    }
    if (!best) {
      el.style.opacity = "0";
      return;
    }
    const count = best.h > 115 ? 3 : best.h > 65 ? 2 : 1,
      end = Math.max(0, snapshot.log.length - historyOffset),
      items = snapshot.log.slice(Math.max(0, end - count), end),
      key = items.map((l) => l.n + ":" + l.text).join("|") + count;
    if (key !== chronicleKey || !el.childElementCount) {
      el.replaceChildren();
      for (const l of items) {
        const row = document.createElement("p");
        row.textContent = l.text;
        row.dataset.event = String(l.n);
        el.append(row);
      }
      chronicleKey = key;
    }
    Object.assign(el.style, {
      left: best.x + "px",
      top: best.y + "px",
      width: best.w + "px",
      height: best.h + "px",
      opacity: "1",
    });
    el.dataset.lines = String(count);
    el.dataset.historyOffset = String(historyOffset);
  }
  function draw(m, x, y, z, sx, sy, sz, c, texture = null, rot = 0, unlit = 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buffer);
    gl.enableVertexAttribArray(attrs[0]);
    gl.enableVertexAttribArray(attrs[1]);
    gl.enableVertexAttribArray(attrs[2]);
    gl.vertexAttribPointer(attrs[0], 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(attrs[1], 3, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(attrs[2], 2, gl.FLOAT, false, 32, 24);
    gl.uniformMatrix4fv(loc.model, false, model(x, y, z, sx, sy, sz, rot));
    gl.uniform3fv(loc.tint, color(c));
    gl.uniform1f(loc.textured, texture ? 1 : 0);
    gl.uniform1f(loc.unlit, unlit);
    gl.bindTexture(gl.TEXTURE_2D, texture || white);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    drawCount++;
  }
  function trophy(x, z, scale = 1, y = 0.34) {
    draw(box, x, y, z, 0.48 * scale, 0.09 * scale, 0.4 * scale, "#d2a949");
    draw(cylinder, x, y + 0.09 * scale, z, 0.16 * scale, 0.24 * scale, 0.16 * scale, "#e2bd5f");
    draw(cup, x, y + 0.29 * scale, z, scale, scale, scale, "#efd486");
    draw(ring, x, y + 0.73 * scale, z, 0.64 * scale, 0.6 * scale, 0.64 * scale, "#fff0b5");
  }
  const rollMesh = (() => {
    const out = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2,
        b = ((i + 1) / 24) * Math.PI * 2;
      quad(
        out,
        [Math.cos(a), Math.sin(a), -0.5],
        [Math.cos(b), Math.sin(b), -0.5],
        [Math.cos(b), Math.sin(b), 0.5],
        [Math.cos(a), Math.sin(a), 0.5],
        [Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0],
      );
    }
    return mesh(out);
  })();
  const pyramid = lathe(
    [
      [0, 0],
      [0.5, 0],
      [0, 1],
    ],
    4,
  );
  const banknote = texture((c, n) => {
    c.fillStyle = "#c7ffd3";
    c.fillRect(0, 0, n, n);
    c.strokeStyle = "#318e70";
    c.lineWidth = 7;
    c.strokeRect(12, 12, n - 24, n - 24);
    c.lineWidth = 2;
    c.strokeRect(24, 24, n - 48, n - 48);
    c.fillStyle = "#116348";
    c.textAlign = "center";
    c.font = "bold 116px Georgia";
    c.fillText("$", n / 2, 162);
    c.font = "bold 22px Arial";
    c.fillText("KENT • PLAY MONEY", n / 2, 220);
  });
  const propCard = (mark, bg, ink) =>
    texture((c, n) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, n, n);
      c.strokeStyle = ink;
      c.lineWidth = 10;
      c.strokeRect(15, 15, n - 30, n - 30);
      c.fillStyle = ink;
      c.textAlign = "center";
      c.font = "900 132px Arial";
      c.fillText(mark, n / 2, 172);
      c.font = "bold 20px Arial";
      c.fillText("KENTOPOLY", n / 2, 222);
    });
  const chanceProp = propCard("?", "#4cbcff", "#0b4168"),
    riskProp = propCard("!", "#ff6686", "#68152c");
  function moneyStack(x, z, r, levels = 4) {
    for (let k = 0; k < levels; k++) {
      const xx = x + k * 0.11,
        zz = z - k * 0.07,
        yy = -0.98 + k * 0.17;
      draw(box, xx, yy, zz, 1.55, 0.15, 0.8, "#d8f4b7", null, r);
      draw(plane, xx, yy + 0.155, zz, 1.5, 1, 0.76, "#fff", banknote, r, 1);
      draw(box, xx, yy + 0.16, zz, 0.17, 0.018, 0.82, "#ffe894", null, r);
    }
  }
  function tokenStack(x, z, c, levels, spread = 0) {
    for (let k = 0; k < levels; k++)
      draw(cylinder, x + (k % 2) * spread, -1 + k * 0.075, z, 0.48, 0.07, 0.48, c);
    draw(ring, x, -0.68 + levels * 0.04, z, 0.52, 1, 0.52, "#fff0a0");
  }
  function cardDeck(x, z, r, tex, c) {
    for (let k = 0; k < 3; k++)
      draw(box, x + k * 0.035, -0.99 + k * 0.045, z - k * 0.025, 1.18, 0.04, 0.82, c, null, r);
    draw(plane, x + 0.07, -0.855, z - 0.05, 1.14, 1, 0.78, "#fff", tex, r, 1);
  }
  function backgroundProps() {
    // The large cash stack remains the hero object behind the board.
    moneyStack(-9.4, -9.2, -0.42, 5);
    [
      [-11.5, -2.5, "#ffd34f", 5],
      [-10.4, 4.5, "#54d7c8", 4],
      [-6.8, 9.8, "#ff7b78", 6],
      [0.2, 11.2, "#ffd34f", 4],
      [7.4, 9.3, "#7ddc91", 5],
      [11.1, 3.6, "#75b8ff", 6],
      [11.4, -4.2, "#e394ff", 4],
      [6.9, -10.3, "#ffd34f", 5],
      [-1.7, -11.7, "#65dbea", 6],
    ].forEach(([x, z, c, levels], i) => tokenStack(x, z, c, levels, i % 2 ? 0.035 : 0));
    [
      [-11.2, 7.7, -0.45, chanceProp, "#2778a8"],
      [11.4, 8.2, 0.38, riskProp, "#a52e50"],
      [10.5, -8.8, -0.62, chanceProp, "#2778a8"],
      [-7.1, -11.1, 0.3, riskProp, "#a52e50"],
    ].forEach(([x, z, r, tex, c]) => cardDeck(x, z, r, tex, c));
  }
  function shade(hex, amount) {
    const rgb = color(hex),
      target = amount > 0 ? 1 : 0,
      mix = Math.abs(amount);
    return (
      "#" +
      rgb
        .map((v) => Math.round((v + (target - v) * mix) * 255).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  function building(t, x, z) {
    if (!sceneBuildingKind(t)) return;
    const d = sceneInward(t.id),
      tangent = [d[1], -d[0]],
      rot = Math.atan2(d[0], d[1]),
      xx = x + d[0] * 0.34,
      zz = z + d[1] * 0.34,
      owner = snapshot.players.find((p) => p.id === t.owner),
      c = BANK_COLORS[owner?.bank] || "#47cfff",
      light = shade(c, 0.38),
      dark = shade(c, -0.44),
      level = Math.min(3, Math.max(0, t.level || 0)),
      district = Math.min(3, Math.max(0, t.district || 0)),
      floor = 0.35;
    draw(box, xx, floor, zz, 0.42, 0.045, 0.34, dark, null, rot);
    if (district === 0) {
      // Residential sector: pitched houses grow into a compact apartment block.
      const h = 0.22 + level * 0.13;
      draw(box, xx, floor + 0.045, zz, 0.31 + level * 0.015, h, 0.27, light, null, rot);
      if (level < 2) draw(pyramid, xx, floor + h + 0.045, zz, 0.47, 0.19, 0.41, c, null, rot + Math.PI / 4);
      else {
        for (let j = 0; j < level + 1; j++)
          draw(box, xx - d[0] * 0.145, floor + 0.1 + j * 0.14, zz - d[1] * 0.145, 0.27, 0.055, 0.018, dark, null, rot);
        draw(box, xx, floor + h + 0.045, zz, 0.36, 0.055, 0.31, c, null, rot);
      }
      draw(box, xx - d[0] * 0.15, floor + 0.07, zz - d[1] * 0.15, 0.09, 0.13, 0.018, dark, null, rot);
    } else if (district === 1) {
      // Retail sector: a wide storefront with awnings and stacked shopping floors.
      const floors = 1 + Math.min(2, level);
      for (let j = 0; j < floors; j++)
        draw(box, xx, floor + 0.045 + j * 0.2, zz, 0.44 - j * 0.04, 0.19, 0.3, j % 2 ? light : c, null, rot);
      draw(box, xx - d[0] * 0.17, floor + 0.12, zz - d[1] * 0.17, 0.38, 0.11, 0.025, "#d9f6ff", null, rot);
      draw(box, xx - d[0] * 0.19, floor + 0.28, zz - d[1] * 0.19, 0.46, 0.07, 0.07, dark, null, rot);
      draw(box, xx, floor + 0.27 + floors * 0.2, zz, 0.25, 0.075, 0.2, c, null, rot);
    } else if (district === 2) {
      // Service sector: a round civic hub with two side wings and a signal mast.
      const h = 0.3 + level * 0.12;
      draw(cylinder, xx, floor + 0.045, zz, 0.3, h, 0.3, c);
      for (const side of [-1, 1])
        draw(box, xx + tangent[0] * side * 0.17, floor + 0.055, zz + tangent[1] * side * 0.17, 0.16, h * 0.68, 0.24, light, null, rot);
      draw(ring, xx, floor + h + 0.05, zz, 0.38, 1, 0.38, dark);
      if (level > 0) {
        draw(cylinder, xx, floor + h + 0.08, zz, 0.035, 0.22 + level * 0.06, 0.035, "#fff0a1");
        draw(sphere, xx, floor + h + 0.28 + level * 0.06, zz, 0.1, 0.1, 0.1, light);
      }
    } else {
      // Corporate sector: asymmetric glass towers with a taller skyline per level.
      const h = 0.52 + level * 0.17;
      draw(box, xx, floor + 0.045, zz, 0.27, h, 0.28, dark, null, rot);
      for (let j = 0; j < 3 + level; j++)
        draw(box, xx, floor + 0.12 + j * 0.13, zz, 0.285, 0.035, 0.295, light, null, rot);
      if (level > 0)
        draw(box, xx + tangent[0] * 0.17, floor + 0.045, zz + tangent[1] * 0.17, 0.15, h * 0.62, 0.22, c, null, rot);
      draw(box, xx, floor + h + 0.045, zz, 0.31, 0.06, 0.32, c, null, rot);
      if (level === 3) draw(cylinder, xx, floor + h + 0.1, zz, 0.025, 0.28, 0.025, "#fff1a7");
    }
  }
  function drawDie(x, y, z, value, yaw, settled) {
    draw(cylinder, x, 0.326, z, 0.82, 0.018, 0.82, "#092e36", null, 0, settled ? 0.38 : 0.18);
    draw(box, x, y, z, 0.76, 0.08, 0.76, "#d4a936", null, yaw, 1);
    draw(box, x, y + 0.06, z, 0.7, 0.62, 0.7, "#fff4cf", null, yaw, 1);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (const [px, pz] of sceneDicePips(value)) {
      const ox = px * 0.19, oz = pz * 0.19;
      draw(
        sphere,
        x + ox * cos + oz * sin,
        y + 0.7,
        z - ox * sin + oz * cos,
        0.095,
        0.026,
        0.095,
        "#173954",
      );
    }
  }
  function renderDice(time) {
    const label = document.querySelector("#dice-result");
    if (!diceAnimation) {
      document.body.classList.remove("dice-in-flight");
      if (label) label.className = "dice-result";
      canvas.dataset.diceStage = "idle";
      return;
    }
    document.body.classList.add("dice-in-flight");
    const elapsed = time - diceAnimation.started,
      stage = sceneDiceStage(elapsed, reduced.matches);
    if (stage === "done") {
      document.body.classList.remove("dice-in-flight");
      if (label) label.className = "dice-result";
      canvas.dataset.diceStage = "done";
      diceAnimation = null;
      return;
    }
    diceAnimation.stage = stage;
    const rolling = stage === "rolling",
      progress = rolling ? Math.min(1, elapsed / 900) : 1;
    diceAnimation.dice.forEach((finalValue, index) => {
      const side = index ? 1 : -1,
        x = rolling
          ? side * (2.15 - progress * 1.34) + Math.sin(progress * 11 + index * 2.3) * 0.16
          : side * 0.78,
        z = rolling
          ? -1.65 + progress * 1.78 + Math.cos(progress * 9 + index) * 0.2
          : 0.12 + side * 0.18,
        y = rolling
          ? 0.34 + (1 - progress) * 1.25 + Math.abs(Math.sin(progress * Math.PI * 3)) * (0.9 - progress * 0.35)
          : 0.34,
        yaw = rolling ? progress * (index ? -13 : 15) + index * 0.7 : side * 0.18,
        value = rolling ? ((Math.floor(elapsed / 85) + index * 3) % 6) + 1 : finalValue;
      drawDie(x, y, z, value, yaw, !rolling);
    });
    if (label) {
      const [a, b] = diceAnimation.dice,
        sum = stage === "sum" ? `<i>=</i><b class="dice-total">${diceAnimation.total}</b>` : "";
      label.className = `dice-result is-visible is-${stage}`;
      label.innerHTML = `<span>${stage === "rolling" ? "КУБИКИ НА СТОЛЕ" : stage === "sum" ? "СУММА ХОДА" : "ВЫПАЛО"}</span><div><b>${stage === "rolling" ? "•" : a}</b><i>+</i><b>${stage === "rolling" ? "•" : b}</b>${sum}</div>`;
    }
    canvas.dataset.diceStage = stage;
    canvas.dataset.diceTotal = String(diceAnimation.total);
  }
  function frame(time) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (!canvas.isConnected || !snapshot || document.hidden || gl.isContextLost()) return;
    const dt = Math.min(0.15, (time - (lastFrame || time)) / 1000);
    lastFrame = time;
    if (snapshot.status === "lobby" && !reduced.matches) azimuth += dt * 0.09;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    if (!diceAnimation && !playing && queue.length) {
      const e = queue.shift(),
        p = pawnPositions.get(e.id);
      if (p) {
        const [x, z] = scenePawnPosition(e.to);
        playing = {
          ...e,
          from: [p.x, p.z],
          target: [x, z],
          started: time,
          duration: e.kind === "walk" ? 310 : 680,
        };
        canvas.dataset.animationCount = String(Number(canvas.dataset.animationCount || 0) + 1);
      }
    }
    let moving = null;
    if (playing) {
      const p = pawnPositions.get(playing.id);
      let t = Math.min(1, (time - playing.started) / playing.duration),
        q = t * t * (3 - 2 * t);
      p.x = playing.from[0] + (playing.target[0] - playing.from[0]) * q;
      p.z = playing.from[1] + (playing.target[1] - playing.from[1]) * q;
      p.hop = Math.sin(t * Math.PI) * (playing.kind === "walk" ? 0.11 : 0.7);
      moving = playing.id;
      if (t >= 1) {
        p.pos = playing.to;
        p.hop = 0;
        finishAt = time;
        lastMovingId = playing.id;
        playing = null;
      }
    }
    if (follow && !reduced.matches && (moving || time - finishAt < 1000)) {
      const p = pawnPositions.get(moving || lastMovingId);
      target = p ? [p.x * 0.5, 0, p.z * 0.5] : [0, 0, 0];
    } else target = [0, 0, 0];
    const ease = reduced.matches ? 1 : 1 - Math.exp(-dt * 3.7);
    cameraTarget = cameraTarget.map((v, i) => v + (target[i] - v) * ease);
    const fit = width / height < 1 ? 1.65 / (width / height + 0.25) : width < 1100 ? 1.2 : 1;
    const desired = 25 * fit * zoom;
    cameraRadius += (desired - cameraRadius) * (reduced.matches ? 1 : Math.min(1, dt * 5));
    eye = [
      cameraTarget[0] + Math.sin(azimuth) * Math.cos(pitch) * cameraRadius,
      Math.sin(pitch) * cameraRadius,
      cameraTarget[2] + Math.cos(azimuth) * Math.cos(pitch) * cameraRadius,
    ];
    const projection = perspective(0.72, width / height);
    projection[9] = -(width < 700 ? 0.26 : 0.04);
    projection[8] = width > 1100 ? 0.035 : 0;
    vp = mult(projection, look(eye, cameraTarget));
    gl.useProgram(program);
    gl.uniformMatrix4fv(loc.vp, false, vp);
    gl.uniform3fv(loc.eye, eye);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawCount = 0;
    draw(plane, 0, -1.035, 0, 70, 1, 70, "#198a93", null, 0, 1);
    backgroundProps();
    draw(box, 0, -0.74, 0, 11.86, 0.17, 11.86, "#031e20");
    draw(box, 0, -0.58, 0, 11.68, 0.16, 11.68, "#ffcf4f");
    draw(box, 0, -0.42, 0, 11.5, 0.62, 11.5, "#2457a0");
    draw(box, 0, 0.19, 0, 8.8, 0.12, 8.8, "#12a57a");
    draw(plane, 0, 0.321, 0, 8.8, 1, 8.8, "#ffffff", centerTexture, 0, 1);
    for (const t of snapshot.tiles) {
      const [x, z] = scenePosition(t.id),
        [cardW, cardD] = sceneTileSize(t.id),
        corner = t.id % 10 === 0,
        inward = sceneInward(t.id),
        cardInward = corner ? [0, 1] : inward,
        tangent = corner ? [1, 0] : [inward[1], -inward[0]],
        rot = Math.atan2(inward[0], inward[1]),
        cardRot = corner ? 0 : rot,
        groupColor =
          t.color ||
          {
            fountain: "#10d5cc",
            chance: "#58c9ff",
            risk: "#ff497c",
            award: "#ffd02a",
            search: "#8c5bff",
            start: "#76e954",
            jail: "#6e92b7",
          }[t.type] ||
          "#c1e6d8";
      draw(box, x, 0.2, z, cardW, 0.13, cardD, corner ? "#cbd2c7" : "#bbc4ba", null, cardRot);
      draw(plane, x, 0.332, z, cardW - 0.045, 1, cardD - 0.045, "#fffdf1", null, cardRot, 1);
      draw(
        box,
        x + inward[0] * (cardD / 2 - 0.1),
        0.334,
        z + inward[1] * (cardD / 2 - 0.1),
        cardW - 0.07,
        0.035,
        0.15,
        groupColor,
        null,
        rot,
        1,
      );
      draw(
        plane,
        x - inward[0] * 0.13,
        0.374,
        z - inward[1] * 0.13,
        corner ? 0.66 : 0.61,
        1,
        corner ? 0.66 : 0.72,
        "#fff",
        tilesTextures[t.id],
        sceneLabelAngle(t.id),
        1,
      );
      if (t.owner) {
        const bc = BANK_COLORS[snapshot.players.find((p) => p.id === t.owner)?.bank] || "#fff";
        draw(
          box,
          x + inward[0] * (cardD / 2 - 0.015),
          0.337,
          z + inward[1] * (cardD / 2 - 0.015),
          cardW - 0.12,
          0.03,
          0.027,
          bc,
          null,
          rot,
          1,
        );
      }
      if (t.id === selected) {
        for (const side of [-1, 1]) {
          draw(box, x + cardInward[0] * side * cardD / 2, 0.342, z + cardInward[1] * side * cardD / 2, cardW, 0.03, 0.028, "#fbe6a0", null, cardRot, 1);
          draw(box, x + tangent[0] * side * cardW / 2, 0.342, z + tangent[1] * side * cardW / 2, 0.028, 0.03, cardD, "#fbe6a0", null, cardRot, 1);
        }
      }
      if (t.type === "fountain") {
        const count = snapshot.tiles.filter(
          (q) => q.type === "fountain" && q.owner && q.owner === t.owner,
        ).length;
        const h = 0.54 + count * 0.12;
        draw(bowl, x, 0.35, z, 0.73, 0.65, 0.73, "#7ec1b2");
        draw(cylinder, x, 0.43, z, 0.58, 0.025, 0.58, "#42bad0", null, 0, 1);
        draw(cylinder, x, 0.43, z, 0.1, h, 0.1, "#bfe7d8");
        draw(bowl, x, 0.43 + h * 0.65, z, 0.43, 0.45, 0.43, "#bfe7d8");
        for (let j = 0; j < 5; j++) {
          const a = (j / 5) * Math.PI * 2,
            anim = reduced.matches ? 0 : (time * 0.0006 + j) % 1;
          draw(
            sphere,
            x + Math.cos(a) * (0.12 + anim * 0.11),
            0.56 + h - anim * 0.35,
            z + Math.sin(a) * (0.12 + anim * 0.11),
            0.065,
            0.12,
            0.065,
            "#95e9ee",
            null,
            0,
            1,
          );
        }
      }
      building(t, x, z);
    }
    trophy(
      ...scenePosition(
        snapshot.award === null
          ? snapshot.tiles.find((t) => t.type === "award").id
          : snapshot.award,
      ),
      0.83,
    );
    // Corner objects are deliberately original low-poly miniatures.
    const [jx, jz] = scenePosition(10);
    for (let i = 0; i < 4; i++)
      draw(cylinder, jx - 0.25 + i * 0.16, 0.35, jz - 0.23, 0.035, 0.4, 0.035, "#627c77");
    draw(box, jx, 0.72, jz - 0.23, 0.6, 0.04, 0.06, "#728d83");
    const [sx, sz] = scenePosition(snapshot.tiles.find((t) => t.type === "search").id);
    draw(cylinder, sx, 0.34, sz, 0.42, 0.16, 0.42, "#9cc8bc");
    draw(ring, sx, 0.51, sz, 0.7, 2, 0.7, "#e1e7d0");
    renderDice(time);
    for (const p of snapshot.players.filter((p) => !p.out)) {
      const pos = pawnPositions.get(p.id);
      if (!pos) continue;
      const cluster = snapshot.players
          .filter((q) => !q.out && q.pos === p.pos)
          .sort((a, b) => a.id.localeCompare(b.id)),
        i = cluster.findIndex((q) => q.id === p.id);
      const inward = sceneInward(p.pos),
        tangent = [inward[1], -inward[0]],
        columns = Math.min(3, cluster.length),
        column = i % 3,
        row = Math.floor(i / 3),
        lateral = (column - (columns - 1) / 2) * 0.19,
        extraOutward = row * 0.15,
        x = pos.x + tangent[0] * lateral - inward[0] * extraOutward,
        z = pos.z + tangent[1] * lateral - inward[1] * extraOutward,
        y = 0.35 + pos.hop;
      const col = BANK_COLORS[p.bank] || "#f5edc9";
      draw(cylinder, x, 0.335, z, 0.44, 0.012, 0.44, "#254c43");
      if (p.pawn === "tower") draw(angularPawn, x, y, z, 0.76, 0.9, 0.76, col);
      else if (p.pawn === "rocket") {
        draw(cone, x, y + 0.05, z, 0.72, 0.78, 0.72, col);
        draw(sphere, x, y + 0.63, z, 0.34, 0.28, 0.34, "#fff0a6");
      } else if (p.pawn === "gem") {
        draw(angularPawn, x, y, z, 0.67, 0.72, 0.67, col);
        draw(sphere, x, y + 0.58, z, 0.42, 0.42, 0.42, col);
      } else if (p.pawn === "tycoon") {
        draw(pawn, x, y, z, 0.72, 0.78, 0.72, col);
        draw(cylinder, x, y + 0.68, z, 0.34, 0.09, 0.34, "#fff0a6");
      } else if (p.pawn === "crown") {
        draw(cup, x, y + 0.03, z, 1.25, 1.45, 1.25, col);
        draw(sphere, x, y + 0.62, z, 0.28, 0.28, 0.28, "#fff0a6");
      } else draw(pawn, x, y, z, 0.72, 0.82, 0.72, col);
      draw(ring, x, y + 0.035, z, 0.5, 1, 0.5, "#e6dba3");
      if (p.id === (moving || snapshot.active)) {
        draw(ring, x, 0.352, z, 0.68, 1.3, 0.68, "#85efd7", null, 0, 1);
        const label = document.querySelector("#pawn-caption"),
          pt = project(x, y + 1, z);
        if (label && pt) {
          label.textContent = p.name;
          label.style.left = pt[0] + "px";
          label.style.top = pt[1] + "px";
          label.style.opacity = "1";
        }
      }
    }
    logPosition();
    const status = document.querySelector("#camera-status");
    if (status)
      status.textContent = moving
        ? follow
          ? "Сопровождение фишки"
          : "Фишка движется"
        : follow
          ? "Автокамера включена"
          : "Свободная камера";
    canvas.dataset.motionActive = moving || "";
    canvas.dataset.cameraTarget = cameraTarget.map((n) => n.toFixed(3)).join(",");
    canvas.dataset.drawCalls = String(drawCount);
    canvas.dataset.ready = "true";
    canvas.dataset.labelAngle = String(sceneLabelAngle(selected >= 0 ? selected : 0));
    canvas.dataset.labelsStatic = "true";
    canvas.dataset.buildings = String(snapshot.tiles.filter((t) => sceneBuildingKind(t)).length);
  }
  let pointer = null,
    hover = null;
  canvas.addEventListener("pointerdown", (ev) => {
    pointer = {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      moved: false,
    };
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {}
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (pointer && pointer.id === ev.pointerId) {
      const dx = ev.clientX - pointer.lastX,
        dy = ev.clientY - pointer.lastY;
      if (Math.hypot(ev.clientX - pointer.x, ev.clientY - pointer.y) > 5) pointer.moved = true;
      if (pointer.moved) {
        azimuth -= dx * 0.006;
        pitch = Math.max(0.48, Math.min(1.3, pitch + dy * 0.004));
        follow = false;
        setMode();
      }
      pointer.lastX = ev.clientX;
      pointer.lastY = ev.clientY;
    } else {
      const rect = canvas.getBoundingClientRect(),
        id = pick(ev.clientX - rect.left, ev.clientY - rect.top);
      hover = id;
      canvas.style.cursor = id === null ? "grab" : "pointer";
      const hint = document.querySelector("#hover-tile");
      if (hint) {
        hint.textContent =
          id === null
            ? "Нажми на клетку — откроется её карточка"
            : snapshot.tiles[id].name +
              " · " +
              (snapshot.tiles[id].price
                ? "$" + snapshot.tiles[id].price.toLocaleString("ru-RU")
                : "Специальная клетка");
      }
    }
  });
  canvas.addEventListener("pointerup", (ev) => {
    if (pointer && pointer.id === ev.pointerId && !pointer.moved) {
      const r = canvas.getBoundingClientRect(),
        id = pick(ev.clientX - r.left, ev.clientY - r.top);
      if (id !== null) onSelect?.(id);
    }
    pointer = null;
  });
  canvas.addEventListener("pointercancel", () => (pointer = null));
  canvas.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      zoom = Math.max(0.32, Math.min(1.6, zoom * Math.exp(ev.deltaY * 0.001)));
      follow = false;
      setMode();
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (ev) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-", "Home"].includes(ev.key)) {
      ev.preventDefault();
      if (ev.key === "Home") {
        overview();
        return;
      }
      if (ev.key === "ArrowLeft") azimuth -= 0.14;
      if (ev.key === "ArrowRight") azimuth += 0.14;
      if (ev.key === "ArrowUp") pitch = Math.min(1.3, pitch + 0.08);
      if (ev.key === "ArrowDown") pitch = Math.max(0.48, pitch - 0.08);
      if (ev.key === "+") zoom = Math.max(0.68, zoom * 0.9);
      if (ev.key === "-") zoom = Math.min(1.6, zoom * 1.1);
      follow = false;
      setMode();
    }
  });
  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    onError?.(
      "Графический контекст потерян. Повтори запуск 3D или перезагрузи страницу; сохранение не удалено.",
    );
    canvas.dataset.ready = "false";
  });
  function overview() {
    follow = false;
    azimuth = Math.PI / 4;
    pitch = 0.88;
    zoom = 1;
    target = [0, 0, 0];
    setMode();
  }
  setMode();
  raf = requestAnimationFrame(frame);
  return {
    canvas,
    update,
    setHistoryOffset(value) {
      historyOffset = Math.max(0, Number(value) || 0);
      chronicleKey = "";
      logPosition();
    },
    overview,
    toggleFollow() {
      follow = !follow && !reduced.matches;
      setMode();
      return follow;
    },
    rotate(amount) {
      azimuth += amount;
      follow = false;
      setMode();
    },
    zoom(amount) {
      zoom = Math.max(0.32, Math.min(1.6, zoom * amount));
      follow = false;
      setMode();
    },
    labelBaseline(id) {
      const [x, z] = scenePosition(id),
        dx = Math.cos(azimuth) * 0.2,
        dz = -Math.sin(azimuth) * 0.2;
      return [project(x - dx, 0.374, z - dz), project(x + dx, 0.374, z + dz)];
    },
    projectTile(id) {
      const [x, z] = scenePosition(id);
      return project(x, 0.34, z);
    },
    debug() {
      return {
        azimuth,
        labelAngle: sceneLabelAngle(azimuth),
        buildings: snapshot?.tiles
          .filter((t) => sceneBuildingKind(t))
          .map((t) => ({ id: t.id, kind: sceneBuildingKind(t) })),
        motionSeq,
        rollSeq,
        diceStage: diceAnimation?.stage || "idle",
        queue: queue.length,
        playing: !!playing,
        follow,
        drawCalls: drawCount,
        target: [...cameraTarget],
        interior: [
          [-4.2, -4.2],
          [4.2, -4.2],
          [4.2, 4.2],
          [-4.2, 4.2],
        ].map(([x, z]) => project(x, 0.34, z)),
      };
    },
    destroy() {
      disposed = true;
      document.body.classList.remove("dice-in-flight");
      cancelAnimationFrame(raf);
      for (const b of resources.buffers) gl.deleteBuffer(b);
      for (const t of resources.textures) gl.deleteTexture(t);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
