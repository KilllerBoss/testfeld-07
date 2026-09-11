/* Testfeld·07 — Mini-WebGL-Engine (eigene, 0 Abhängigkeiten, offline)
 * Bewusste Entscheidung: statt three.js (≈1 MB, CDN/Bundle-Risiko in der
 * WebView) eine kompakte Engine — genau genug für Low-Poly-Roboter:
 * Phong-artig (Richtungslicht + Hemisphäre), Exp2-Nebel, Unlit/Emissive,
 * Blending für Geister, Linien-Raster, Punkte für Sterne.
 */
(function (global) {
  'use strict';

  /* ---------- Mathe ---------- */
  function mat4Identity() { return new Float64Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }

  function mat4Mul(o, a, b) {
    // o = a*b (column-major, OpenGL-Stil)
    var r = new Float64Array(16);
    for (var c = 0; c < 4; c++) for (var rw = 0; rw < 4; rw++) {
      r[c*4+rw] = a[rw]*b[c*4] + a[4+rw]*b[c*4+1] + a[8+rw]*b[c*4+2] + a[12+rw]*b[c*4+3];
    }
    o.set(r); return o;
  }

  function mat4Persp(o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1;
    o[14] = 2 * far * near / (near - far);
    return o;
  }

  function mat4LookAt(o, eye, ctr, up) {
    var zx = eye[0]-ctr[0], zy = eye[1]-ctr[1], zz = eye[2]-ctr[2];
    var zl = Math.sqrt(zx*zx+zy*zy+zz*zz) || 1; zx/=zl; zy/=zl; zz/=zl;
    var xx = up[1]*zz - up[2]*zy, xy = up[2]*zx - up[0]*zz, xz = up[0]*zy - up[1]*zx;
    var xl = Math.sqrt(xx*xx+xy*xy+xz*xz) || 1; xx/=xl; xy/=xl; xz/=xl;
    var yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
    o[0]=xx; o[1]=yx; o[2]=zx; o[3]=0;
    o[4]=xy; o[5]=yy; o[6]=zy; o[7]=0;
    o[8]=xz; o[9]=yz; o[10]=zz; o[11]=0;
    o[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    o[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    o[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    o[15]=1;
    return o;
  }

  // Komposition: T(pos) * R(quat) * S(scale) — column-major
  function mat4Compose(o, px, py, pz, qx, qy, qz, qw, sx, sy, sz) {
    var x2=qx+qx, y2=qy+qy, z2=qz+qz;
    var xx=qx*x2, xy=qx*y2, xz=qx*z2, yy=qy*y2, yz=qy*z2, zz=qz*z2;
    var wx=qw*x2, wy=qw*y2, wz=qw*z2;
    o[0]=(1-(yy+zz))*sx; o[1]=(xy+wz)*sx;   o[2]=(xz-wy)*sx;   o[3]=0;
    o[4]=(xy-wz)*sy;   o[5]=(1-(xx+zz))*sy; o[6]=(yz+wx)*sy;   o[7]=0;
    o[8]=(xz+wy)*sz;   o[9]=(yz-wx)*sz;   o[10]=(1-(xx+yy))*sz; o[11]=0;
    o[12]=px; o[13]=py; o[14]=pz; o[15]=1;
    return o;
  }

  function quatMul(a, b) {
    // a*b
    var ax=a[0],ay=a[1],az=a[2],aw=a[3], bx=b[0],by=b[1],bz=b[2],bw=b[3];
    return [
      aw*bx+ax*bw+ay*bz-az*by,
      aw*by-ax*bz+ay*bw+az*bx,
      aw*bz+ax*by-ay*bx+az*bw,
      aw*bw-ax*bx-ay*by-az*bz
    ];
  }

  function quatAxis(axis, ang) {
    var l = Math.sqrt(axis[0]*axis[0]+axis[1]*axis[1]+axis[2]*axis[2]) || 1;
    var s = Math.sin(ang/2);
    return [axis[0]/l*s, axis[1]/l*s, axis[2]/l*s, Math.cos(ang/2)];
  }

  var IDQ = [0,0,0,1];

  /* ---------- Meshes ---------- */
  function Mesh(gl, verts, idx, mode) {
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.count = idx.length;
    this.mode = mode === undefined ? gl.TRIANGLES : mode;
  }

  function pushBox(verts, idx, sx, sy, sz) {
    // Einheitsbox, skaliert um (sx,sy,sz), zentriert; 24 Verts mit Normalen
    var base = verts.length / 6;
    var faces = [
      [[ 1,0,0],  [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],
      [[-1,0,0],  [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],
      [[0,1,0],   [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],
      [[0,-1,0],  [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],
      [[0,0,1],   [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
      [[0,0,-1],  [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]]
    ];
    for (var f = 0; f < 6; f++) {
      var n = faces[f][0], q = faces[f][1];
      for (var i = 0; i < 4; i++)
        verts.push(q[i][0]*sx/2, q[i][1]*sy/2, q[i][2]*sz/2, n[0], n[1], n[2]);
      idx.push(base+f*4, base+f*4+1, base+f*4+2, base+f*4, base+f*4+2, base+f*4+3);
    }
  }

  function pushCyl(verts, idx, r, h, seg) {
    var base = verts.length / 6;
    for (var i = 0; i <= seg; i++) {
      var a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      verts.push(c*r, -h/2, s*r, c, 0, s);
      verts.push(c*r,  h/2, s*r, c, 0, s);
    }
    for (i = 0; i < seg; i++) {
      var b = base + i*2;
      idx.push(b, b+1, b+2, b+1, b+3, b+2);
    }
    // Deckel
    var cTop = verts.length / 6;
    verts.push(0, h/2, 0, 0, 1, 0);
    verts.push(0, -h/2, 0, 0, -1, 0);
    for (i = 0; i <= seg; i++) {
      a = i / seg * Math.PI * 2; c = Math.cos(a); s = Math.sin(a);
      verts.push(c*r, h/2, s*r, 0, 1, 0);
      verts.push(c*r, -h/2, s*r, 0, -1, 0);
    }
    for (i = 0; i < seg; i++) {
      var t0 = cTop + 2 + i*2;
      idx.push(cTop, t0, t0+2);
      idx.push(cTop+1, t0+3, t0+1);
    }
  }

  function pushSphere(verts, idx, r, la, lo) {
    var base = verts.length / 6;
    for (var y = 0; y <= la; y++) {
      var vy = y / la * Math.PI, ny = Math.cos(vy);
      for (var x = 0; x <= lo; x++) {
        var vx = x / lo * Math.PI * 2;
        var nx = Math.sin(vy) * Math.cos(vx), nz = Math.sin(vy) * Math.sin(vx);
        verts.push(r*nx, r*ny, r*nz, nx, ny, nz);
      }
    }
    for (y = 0; y < la; y++) for (x = 0; x < lo; x++) {
      var a = base + y*(lo+1) + x;
      idx.push(a, a+lo+1, a+1, a+1, a+lo+1, a+lo+2);
    }
  }

  function pushRing(verts, idx, ri, ro, seg, y) {
    var base = verts.length / 6;
    for (var i = 0; i <= seg; i++) {
      var a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      verts.push(c*ri, y, s*ri, 0, 1, 0);
      verts.push(c*ro, y, s*ro, 0, 1, 0);
    }
    for (i = 0; i < seg; i++) {
      var b = base + i*2;
      idx.push(b, b+2, b+1, b+1, b+2, b+3);
    }
  }

  function pushPlane(verts, idx, size, y) {
    var base = verts.length / 6, h = size/2;
    verts.push(-h,y,-h, 0,1,0,  h,y,-h, 0,1,0,  h,y,h, 0,1,0,  -h,y,h, 0,1,0);
    idx.push(base, base+2, base+1, base, base+3, base+2);
  }

  function pushLineGrid(verts, size, step, y) {
    var h = size/2;
    for (var v = -h; v <= h + 1e-9; v += step) {
      verts.push(-h, y, v, 0,1,0,  h, y, v, 0,1,0);
      verts.push(v, y, -h, 0,1,0,  v, y, h, 0,1,0);
    }
  }

  /* ---------- Node (Szenengraph, minimal) ---------- */
  function Node(mesh, color, opts) {
    opts = opts || {};
    this.mesh = mesh || null;
    this.color = color || [1,1,1,1];
    this.pos = [0,0,0]; this.quat = IDQ.slice(); this.scale = [1,1,1];
    this.lit = opts.lit !== false;
    this.visible = true;
    this.children = [];
    this.world = mat4Identity();
    this._dirty = true;
  }
  Node.prototype.add = function (c) { this.children.push(c); return c; };
  Node.prototype.set = function (x, y, z, q) {
    this.pos[0]=x; this.pos[1]=y; this.pos[2]=z;
    if (q) this.quat = q;
  };
  Node.prototype.updateWorld = function (parentMat) {
    var local = mat4Compose(new Float64Array(16),
      this.pos[0], this.pos[1], this.pos[2],
      this.quat[0], this.quat[1], this.quat[2], this.quat[3],
      this.scale[0], this.scale[1], this.scale[2]);
    if (parentMat) mat4Mul(this.world, parentMat, local);
    else this.world.set(local);
    for (var i = 0; i < this.children.length; i++) this.children[i].updateWorld(this.world);
  };

  /* ---------- Renderer ---------- */
  var VS = [
    'attribute vec3 aPos; attribute vec3 aNormal;',
    'uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uNormalMat;',
    'uniform float uPointSize;',
    'varying vec3 vNormal;',
    'void main(){',
    '  vNormal = uNormalMat * aNormal;',
    '  gl_Position = uVP * uModel * vec4(aPos, 1.0);',
    '  gl_PointSize = uPointSize;',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'uniform vec4 uColor; uniform vec3 uLightDir; uniform vec3 uLightColor;',
    'uniform vec3 uAmbSky; uniform vec3 uAmbGnd;',
    'uniform vec3 uFogColor; uniform float uFogDensity;',
    'uniform float uLit; uniform float uCamDist;',
    'void main(){',
    '  vec3 n = normalize(vNormal);',
    '  vec3 col;',
    '  if (uLit > 0.5) {',
    '    float diff = max(dot(n, uLightDir), 0.0);',
    '    vec3 hemi = mix(uAmbGnd, uAmbSky, n.y * 0.5 + 0.5);',
    '    col = uColor.rgb * (uLightColor * diff * 0.85 + hemi);',
    '  } else { col = uColor.rgb; }',
    '  float f = 1.0 - exp(-uCamDist * uFogDensity);',
    '  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, uColor.a);',
    '}'
  ].join('\n');

  function Renderer(canvas) {
    var gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ||
             canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL nicht verfügbar');
    this.gl = gl;
    this.canvas = canvas;

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);
    this.a = {
      pos: gl.getAttribLocation(prog, 'aPos'),
      normal: gl.getAttribLocation(prog, 'aNormal')
    };
    this.u = {};
    var names = ['uVP','uModel','uNormalMat','uColor','uLightDir','uLightColor',
                 'uAmbSky','uAmbGnd','uFogColor','uFogDensity','uLit','uPointSize','uCamDist'];
    for (var i = 0; i < names.length; i++) this.u[names[i]] = gl.getUniformLocation(prog, names[i]);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this.lightDir = [0.45, 0.8, 0.35];
    this.lightColor = [1.0, 0.98, 0.92];
    this.ambSky = [0.45, 0.5, 0.6];
    this.ambGnd = [0.22, 0.2, 0.18];
    this.fogColor = [0.06, 0.065, 0.08];
    this.fogDensity = 0.010;
    this.bg = [0.06, 0.065, 0.08];
    this.camDist = 8;

    this.proj = mat4Identity();
    this.view = mat4Identity();
    this.vp = mat4Identity();
    this.tmp = mat4Identity();
  }

  Renderer.prototype.setSize = function (w, h, dpr) {
    dpr = Math.min(dpr || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    mat4Persp(this.proj, 55 * Math.PI / 180, w / Math.max(1, h), 0.05, 120);
  };

  Renderer.prototype.setCamera = function (eye, ctr, up) {
    mat4LookAt(this.view, eye, ctr, up || [0,1,0]);
    mat4Mul(this.vp, this.proj, this.view);
  };

  Renderer.prototype.begin = function () {
    var gl = this.gl;
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };

  var NM = new Float64Array(9);
  function normalMat(m) {
    // Nur Rotation+uniforme Skalierung: obere 3×3, Spalten normalisieren
    for (var c = 0; c < 3; c++) {
      var l = Math.sqrt(m[c*4]*m[c*4] + m[c*4+1]*m[c*4+1] + m[c*4+2]*m[c*4+2]) || 1;
      NM[c*3] = m[c*4]/l; NM[c*3+1] = m[c*4+1]/l; NM[c*3+2] = m[c*4+2]/l;
    }
    return NM;
  }

  Renderer.prototype.drawNode = function (node, alphaMul) {
    if (!node.visible) return;
    var gl = this.gl;
    var a = 1;
    var col = node.color;
    if (col[3] < 1 || alphaMul < 1) a = col[3] * (alphaMul === undefined ? 1 : alphaMul);
    if (a < 0.999) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    var nm = normalMat(node.world);
    gl.uniformMatrix4fv(this.u.uVP, false, this.vp);
    gl.uniformMatrix4fv(this.u.uModel, false, node.world);
    gl.uniformMatrix3fv(this.u.uNormalMat, false, nm);
    gl.uniform4f(this.u.uColor, col[0], col[1], col[2], a);
    gl.uniform3f(this.u.uLightDir, this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    gl.uniform3f(this.u.uLightColor, this.lightColor[0], this.lightColor[1], this.lightColor[2]);
    gl.uniform3f(this.u.uAmbSky, this.ambSky[0], this.ambSky[1], this.ambSky[2]);
    gl.uniform3f(this.u.uAmbGnd, this.ambGnd[0], this.ambGnd[1], this.ambGnd[2]);
    gl.uniform3f(this.u.uFogColor, this.fogColor[0], this.fogColor[1], this.fogColor[2]);
    gl.uniform1f(this.u.uFogDensity, this.fogDensity);
    gl.uniform1f(this.u.uLit, node.lit ? 1 : 0);
    gl.uniform1f(this.u.uPointSize, 2.0);
    gl.uniform1f(this.u.uCamDist, this.camDist);
    if (node.mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.vbo);
      gl.vertexAttribPointer(this.a.pos, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(this.a.normal, 3, gl.FLOAT, false, 24, 12);
      gl.enableVertexAttribArray(this.a.pos);
      gl.enableVertexAttribArray(this.a.normal);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, node.mesh.ibo);
      gl.drawElements(node.mesh.mode, node.mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    for (var i = 0; i < node.children.length; i++) this.drawNode(node.children[i], a);
    if (a < 0.999) { gl.disable(gl.BLEND); gl.depthMask(true); }
  };

  /* ---------- Mesh-Factory ---------- */
  function Meshes(gl) {
    function mk(verts, idx, mode) { return new Mesh(gl, verts, idx, mode); }
    this.unitBox = (function () {
      var v = [], i = []; pushBox(v, i, 1, 1, 1); return mk(v, i);
    })();
    this.unitCyl = (function () {
      var v = [], i = []; pushCyl(v, i, 1, 1, 24); return mk(v, i);
    })();
    this.unitSphere = (function () {
      var v = [], i = []; pushSphere(v, i, 1, 10, 16); return mk(v, i);
    })();
    this.disc = (function () {
      var v = [], i = []; pushRing(v, i, 0, 1, 20, 0); return mk(v, i);
    })();
    this.ring = (function () {
      var v = [], i = []; pushRing(v, i, 0.82, 1.0, 32, 0); return mk(v, i);
    })();
    this.plane = (function () {
      var v = [], i = []; pushPlane(v, i, 1, 0); return mk(v, i);
    })();
    this.grid = (function () {
      var v = []; pushLineGrid(v, 20, 1, 0.005);
      var i = []; for (var k = 0; k < v.length / 6 / 2; k++) i.push(k*2, k*2+1);
      return mk(v, i, gl.LINES);
    })();
  }

  global.TF07 = global.TF07 || {};
  global.TF07.render = {
    Renderer: Renderer,
    Meshes: Meshes,
    Mesh: Mesh,
    Node: Node,
    quatAxis: quatAxis,
    quatMul: quatMul,
    mat4Compose: mat4Compose,
    IDQ: IDQ
  };
})(typeof window !== 'undefined' ? window : globalThis);
