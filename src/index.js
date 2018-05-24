// Constants
const VERTEX_SIZE = 2;
const COLOR_SIZE = 4;
const TEXTURE_SIZE = 1;
const REGION_SIZE = 2;

const ELEMENT_SIZE = VERTEX_SIZE + COLOR_SIZE + TEXTURE_SIZE + REGION_SIZE;
const ELEMENT_OFFSET = ELEMENT_SIZE * Float32Array.BYTES_PER_ELEMENT;

const VERTEX_ELEMENT = 0;
const COLOR_ELEMENT = VERTEX_ELEMENT + VERTEX_SIZE;
const TEXTURE_ELEMENT = COLOR_ELEMENT + COLOR_SIZE;
const REGION_ELEMENT = TEXTURE_ELEMENT + TEXTURE_SIZE;

const VERTEX_OFFSET = VERTEX_ELEMENT * Float32Array.BYTES_PER_ELEMENT;
const COLOR_OFFSET = COLOR_ELEMENT * Float32Array.BYTES_PER_ELEMENT;
const TEXTURE_OFFSET = TEXTURE_ELEMENT * Float32Array.BYTES_PER_ELEMENT;
const REGION_OFFSET = REGION_ELEMENT * Float32Array.BYTES_PER_ELEMENT;

const ELEMENTS_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

const MAX_LENGTH = 16000;

class Shader {
  /**
   * @param {WebGLRenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;
  }

  /**
   * @private
   * @param {number} type
   * @param {string} source
   * @returns {WebGLShader}
   */
  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      throw new Error(`QuadShader.creareShader: failed on shader compilation:\n${log}`);
    }

    return shader;
  }

  /**
   * @private
   * @param {WebGLShader} vertex
   * @param {WebGLShader} fragment
   */
  createProgram(vertex, fragment) {
    const gl = this.gl;
    const program = gl.createProgram();

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.validateProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      throw new Error(`QuadShader.createProgram: failed on program linking:\n${log}`);
    }

    gl.useProgram(program);

    return program;
  }

  /**
   * @param {string} name
   */
  getAttribute(name) {
    const gl = this.gl;
    const location = gl.getAttribLocation(this.program, name)
    gl.enableVertexAttribArray(location);
    return location;
  }
}

class QuadShader extends Shader {
  /**
   * @param {WebGLRenderingContext} gl
   * @param {number} maxTexture
   * @param {string} precision
   */
  constructor(gl, maxTexture, precision) {
    super(gl);

    this.vertex = this.createShader(
      gl.VERTEX_SHADER,
      `
        precision highp float;

        attribute vec2 aVertex;
        attribute vec4 aColor;
        attribute float aTexture;
        attribute vec2 aRegion;

        uniform mat3 uMatrix;

        varying vec4 vColor;
        varying float vTexture;
        varying vec2 vRegion;

        void main(void) {
          gl_Position = vec4((uMatrix * vec3(aVertex, 1)).xy, 0, 1);

          vColor = vec4(aColor.rgb * aColor.a, aColor.a);
          vTexture = aTexture;
          vRegion = aRegion;
        }
      `,
    );

    /*
    const textureSelector = [];
    textureSelector.push(`if (texture == 0) gl_FragColor = texture2D(uSampler[0], vRegion) * vColor;`);
    for (let i = 1; i < maxTexture - 1; i++) {
      textureSelector.push(`else if (texture == ${i}) gl_FragColor = texture2D(uSampler[${i}], vRegion) * vColor;`)
    }
    textureSelector.push(`else gl_FragColor = texture2D(uSampler[${maxTexture - 1}], vRegion) * vColor;`)
    */

    this.fragment = this.createShader(
      gl.FRAGMENT_SHADER,
      `
        precision ${precision} float;

        /*uniform sampler2D uSampler[${maxTexture}];*/
        uniform sampler2D uSampler;

        varying vec4 vColor;
        varying float vTexture;
        varying vec2 vRegion;

        void main(void) {
          int texture = int(vTexture);

          gl_FragColor = texture2D(uSampler, vRegion);
          ${/*textureSelector.join(`
          `)*/''}
        }
      `,
    );

    this.program = this.createProgram(this.vertex, this.fragment);

    this.attributes = {
      vertex: this.getAttribute('aVertex'),
      color: this.getAttribute('aColor'),
      texture: this.getAttribute('aTexture'),
      region: this.getAttribute('aRegion'),
    };

    this.uniforms = {
      matrix: gl.getUniformLocation(this.program, 'uMatrix'),
      sampler: gl.getUniformLocation(this.program, 'uSampler'),
    };
  }
}

class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    const gl = canvas.getContext('webgl');

    this.length = 0;

    this.canvas = canvas;
    this.gl = gl;

    const maxTextures = Math.min(24, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    const {precision} = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const precisionName = precision < 16 ? 'mediump' : 'highp';

    this.maxTextures = maxTextures;
    this.precision = precisionName;

    this.shader = new QuadShader(gl, maxTextures, precisionName);

    // Stream buffer
    this.sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sb);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      MAX_LENGTH * ELEMENT_OFFSET * ELEMENTS_PER_QUAD,
      gl.STREAM_DRAW,
    );

    this.sbSize = 256;
    this.sbOffset = 0;

    this.stream = new Float32Array(this.sbSize * ELEMENT_SIZE * ELEMENTS_PER_QUAD);

    // Index buffer
    this.ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.createIB(), gl.STATIC_DRAW);

    console.log(this.shader.attributes);

    // Bind attribute pointers
    gl.vertexAttribPointer(
      this.shader.attributes.vertex,
      VERTEX_SIZE,
      gl.FLOAT,
      false,
      ELEMENT_OFFSET,
      VERTEX_OFFSET
    );
    gl.vertexAttribPointer(
      this.shader.attributes.color,
      COLOR_SIZE,
      gl.FLOAT,
      false,
      ELEMENT_OFFSET,
      COLOR_OFFSET
    );
    gl.vertexAttribPointer(
      this.shader.attributes.texture,
      TEXTURE_SIZE,
      gl.FLOAT,
      false,
      ELEMENT_OFFSET,
      TEXTURE_OFFSET
    );
    gl.vertexAttribPointer(
      this.shader.attributes.region,
      REGION_SIZE,
      gl.FLOAT,
      false,
      ELEMENT_OFFSET,
      REGION_OFFSET
    );

    gl.useProgram(this.shader.program);
    this.reset();
    this.setProjection(canvas.width, canvas.height);

    this.units = [];
    for (let i = 0; i < maxTextures; i++) {
      this.units.push(i);
    }
    this.cache = new Map();

    this.color = [1, 1, 1, 1];

    // Initialize claer color and alpha blend function
    gl.clearColor(...this.color);
    gl.clearDepth(1.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  setProjection(width, height) {
    const gl = this.gl;
    const matrix = [
      2 / width, 0, 0,
      0, -2 / height, 0,
      -1, 1, 1,
    ];
    console.log('matrix', matrix);

    gl.viewport(-width, -height, width, height);
    gl.uniformMatrix3fv(
      this.shader.uniforms.matrix,
      false,
      matrix,
    );
  }

  reset() {
    const gl = this.gl;

    this.sbOffset = 0;
    this.length = 0;

    /*
    const samplers = new Array(this.maxTextures);
    for (let i = 0; i < this.maxTextures; i++) {
      samplers[i] = i;
    }
    */

    gl.uniform1i(this.shader.uniforms.sampler, 0);
  }

  clear() {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  flush() {
    if (this.length > 0) {
      const gl = this.gl;

      const length = this.length * ELEMENT_SIZE * ELEMENTS_PER_QUAD;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sb);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.stream.subarray(0, length),
      );
      console.log('stream', this.stream.subarray(0, length));

      gl.drawElements(
        gl.TRIANGLE_STRIP,
        this.length * INDICES_PER_QUAD,
        gl.UNSIGNED_SHORT,
        0,
      );

      this.sbOffset = 0;
      this.length = 0;
    }
  }

  /**
   * @param {HTMLImageElement} image
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {number} regionX
   * @param {number} regionY
   * @param {number} regionWidth
   * @param {number} regionHeight
   */
  drawImage(image, x, y, width, height, regionX, regionY, regionWidth, regionHeight) {
    if (this.length >= MAX_LENGTH) {
      this.flush();
    }
    if (this.length >= this.sbSize) {
      this.resizeSB();
    }

    const idx0 = this.sbOffset;
    const idx1 = idx0 + ELEMENT_SIZE;
    const idx2 = idx1 + ELEMENT_SIZE;
    const idx3 = idx2 + ELEMENT_SIZE;

    const x0 = x;
    const y0 = y;
    const x1 = x + width;
    const y1 = y;
    const x2 = x;
    const y2 = y + height;
    const x3 = x + width;
    const y3 = y + height;

    const color = this.color;

    const unit = this.uploadImage(image);

    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;
    const r0 = regionX / imageWidth;
    const r1 = regionY / imageHeight;
    const r2 = (regionX + regionWidth) / imageWidth;
    const r3 = (regionY + regionHeight) / imageHeight;
    console.log('r', r0, r1, r2, r3);

    this.stream[idx0 + VERTEX_ELEMENT + 0] = x0;
    this.stream[idx0 + VERTEX_ELEMENT + 1] = y0;
    this.stream[idx1 + VERTEX_ELEMENT + 0] = x1;
    this.stream[idx1 + VERTEX_ELEMENT + 1] = y1;
    this.stream[idx2 + VERTEX_ELEMENT + 0] = x2;
    this.stream[idx2 + VERTEX_ELEMENT + 1] = y2;
    this.stream[idx3 + VERTEX_ELEMENT + 0] = x3;
    this.stream[idx3 + VERTEX_ELEMENT + 1] = y3;

    this.stream.set(color, idx0 + COLOR_ELEMENT);
    this.stream.set(color, idx1 + COLOR_ELEMENT);
    this.stream.set(color, idx2 + COLOR_ELEMENT);
    this.stream.set(color, idx3 + COLOR_ELEMENT);

    this.stream[idx0 + TEXTURE_ELEMENT] = unit;
    this.stream[idx1 + TEXTURE_ELEMENT] = unit;
    this.stream[idx2 + TEXTURE_ELEMENT] = unit;
    this.stream[idx3 + TEXTURE_ELEMENT] = unit;

    this.stream[idx0 + REGION_ELEMENT + 0] = r0;
    this.stream[idx0 + REGION_ELEMENT + 1] = r1;
    this.stream[idx1 + REGION_ELEMENT + 0] = r2;
    this.stream[idx1 + REGION_ELEMENT + 1] = r1;
    this.stream[idx2 + REGION_ELEMENT + 0] = r0;
    this.stream[idx2 + REGION_ELEMENT + 1] = r3;
    this.stream[idx3 + REGION_ELEMENT + 0] = r2;
    this.stream[idx3 + REGION_ELEMENT + 1] = r3;

    this.sbOffset += ELEMENT_SIZE * ELEMENTS_PER_QUAD;
    this.length += 1;
  }

  uploadImage(image) {
    if (this.cache.has(image)) {
      return this.cache.get(image).unit;
    }

    const gl = this.gl;
    const unit = this.units.shift();
    const texture = gl.createTexture();

    console.log('texture', texture);
    console.log('unit', unit, gl.TEXTURE0);

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.cache.set(image, {unit, texture});

    return unit;
  }

  /**
   * @private
   */
  createIB() {
    var indices = [
      0, 1, 2,
      2, 1, 3,
    ];

    // ~384KB index buffer
    const data = new Array(MAX_LENGTH * INDICES_PER_QUAD);
    for (var i = 0; i < data.length; i++) {
      data[i] = indices[i % INDICES_PER_QUAD] +
        ~~(i / INDICES_PER_QUAD) * ELEMENTS_PER_QUAD;
    }

    return new Uint16Array(data);
  }

  /**
   * @private
   */
  resizeSB() {
    this.sbSize <<= 1;
    const stream = new Float32Array(this.sbSize * ELEMENT_SIZE * ELEMENTS_PER_QUAD);
    stream.set(this.stream);
    this.stream = stream;
  }
}

const canvas = document.querySelector('#app');
canvas.width = 256;
canvas.height = 256;

const renderer = new Renderer(canvas);

const image = new Image();
image.crossOrigin = 'anonymous';
image.onload = () => {
  renderer.clear();
  renderer.drawImage(image, 0, 0, 256, 256, 0, 0, 256, 256);
  renderer.flush();
  renderer.gl.flush();
  console.log(renderer);

  document.body.appendChild(image);
};
image.src = 'https://picsum.photos/256/256'