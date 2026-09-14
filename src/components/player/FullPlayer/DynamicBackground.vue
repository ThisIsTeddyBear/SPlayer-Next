<script setup lang="ts">
/*
 * Dynamic background renderer adapted from Jellyfin LyricMotion's
 * DynamicBackgroundRenderer. Its upstream notices identify the MIT-licensed
 * Kawarp renderer and Dynamic Background theme; see THIRD_PARTY_NOTICES.md.
 */
import DEFAULT_COVER from "@/assets/images/song.jpg";

interface Framebuffer {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface DynamicBackgroundOptions {
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

const props = defineProps<{
  album: string;
  playing: boolean;
}>();

const BLUR_SIZE = 128;
const BLUR_PASSES = 8;
const TRANSITION_DURATION = 260;
const TINT_COLOR = new Float32Array([0.157, 0.157, 0.235]);

const vertexShader = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const blurShader = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_offset;
  varying vec2 v_texCoord;
  void main() {
    vec2 texel = 1.0 / u_resolution;
    vec4 color = vec4(0.0);
    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, -u_offset) * texel);
    color += texture2D(u_texture, v_texCoord + vec2( u_offset, -u_offset) * texel);
    color += texture2D(u_texture, v_texCoord + vec2(-u_offset,  u_offset) * texel);
    color += texture2D(u_texture, v_texCoord + vec2( u_offset,  u_offset) * texel);
    gl_FragColor = color * 0.25;
  }
`;

const blendShader = `
  precision highp float;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform float u_blend;
  varying vec2 v_texCoord;
  void main() {
    gl_FragColor = mix(texture2D(u_texture1, v_texCoord), texture2D(u_texture2, v_texCoord), u_blend);
  }
`;

const tintShader = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec3 u_tintColor;
  uniform float u_tintIntensity;
  varying vec2 v_texCoord;
  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);
    color.rgb = mix(color.rgb, u_tintColor, darkMask * u_tintIntensity);
    gl_FragColor = color;
  }
`;

const warpShader = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_time;
  uniform float u_intensity;
  varying vec2 v_texCoord;
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  void main() {
    vec2 uv = v_texCoord;
    float t = u_time * 0.05;
    vec2 center = uv - 0.5;
    float centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));
    float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));
    float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0));
    float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));
    float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));
    vec2 warp = vec2(n1 * 0.65 + n3 * 0.35, n2 * 0.65 + n4 * 0.35) * centerWeight;
    vec2 warpedUV = clamp(uv + warp * u_intensity, 0.0, 1.0);
    gl_FragColor = texture2D(u_texture, warpedUV);
  }
`;

const outputShader = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_saturation;
  uniform float u_dithering;
  uniform float u_time;
  uniform float u_scale;
  uniform vec2 u_resolution;
  varying vec2 v_texCoord;
  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  void main() {
    vec2 uv = (v_texCoord - 0.5) / u_scale + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    vec4 color = texture2D(u_texture, uv);
    vec2 center = v_texCoord - 0.5;
    float vignette = 1.0 - dot(center, center) * 0.3;
    color.rgb *= vignette;
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, u_saturation);
    vec2 pixelPos = floor(v_texCoord * u_resolution);
    float noise = hash(vec3(pixelPos, floor(u_time * 60.0)));
    color.rgb += (noise - 0.5) * u_dithering;
    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;

class DynamicBackgroundRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly onContextLost?: () => void;
  private readonly onContextRestored?: () => void;
  private readonly halfFloatExt: { HALF_FLOAT_OES: number } | null;
  private readonly supportsHalfFloatFramebuffer: boolean;
  private readonly programs: Record<string, WebGLProgram>;
  private readonly positionBuffer: WebGLBuffer;
  private readonly texCoordBuffer: WebGLBuffer;
  private readonly sourceTexture: WebGLTexture;
  private readonly blurFBO1: Framebuffer;
  private readonly blurFBO2: Framebuffer;
  private currentAlbumFBO: Framebuffer;
  private nextAlbumFBO: Framebuffer;
  private snapshotAlbumFBO: Framebuffer;
  private readonly blendScratchFBO: Framebuffer;
  private warpFBO: Framebuffer;
  private animationId = 0;
  private lastFrameTime = 0;
  private accumulatedTime = 0;
  private isPlaying = false;
  private hasCurrent = false;
  private isTransitioning = false;
  private transitionStartTime = 0;
  private contextLost = false;
  private renderWidth = 0;
  private renderHeight = 0;

  constructor(canvas: HTMLCanvasElement, options: DynamicBackgroundOptions = {}) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL is not supported");

    this.gl = gl;
    this.canvas = canvas;
    this.onContextLost = options.onContextLost;
    this.onContextRestored = options.onContextRestored;
    this.halfFloatExt = gl.getExtension("OES_texture_half_float");
    this.supportsHalfFloatFramebuffer = Boolean(
      this.halfFloatExt &&
      gl.getExtension("OES_texture_half_float_linear") &&
      gl.getExtension("EXT_color_buffer_half_float"),
    );
    this.programs = {
      blur: this.createProgram(vertexShader, blurShader),
      blend: this.createProgram(vertexShader, blendShader),
      tint: this.createProgram(vertexShader, tintShader),
      warp: this.createProgram(vertexShader, warpShader),
      output: this.createProgram(vertexShader, outputShader),
    };
    this.positionBuffer = this.createBuffer(
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    );
    this.texCoordBuffer = this.createBuffer(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
    this.sourceTexture = this.createTexture();
    this.blurFBO1 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.blurFBO2 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.currentAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.nextAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.snapshotAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.blendScratchFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.warpFBO = this.createFramebuffer(1, 1);

    canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored, false);
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.stop();
    this.onContextLost?.();
  };

  private readonly handleContextRestored = () => {
    this.contextLost = false;
    this.onContextRestored?.();
  };

  private createShader(type: number, source: string) {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("Unable to create WebGL shader");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader) || "Unknown shader error";
      this.gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  private createProgram(vertexSource: string, fragmentSource: string) {
    const vertex = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
    const fragment = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.gl.createProgram();
    if (!program) throw new Error("Unable to create WebGL program");
    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.bindAttribLocation(program, 0, "a_position");
    this.gl.bindAttribLocation(program, 1, "a_texCoord");
    this.gl.linkProgram(program);
    this.gl.deleteShader(vertex);
    this.gl.deleteShader(fragment);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const message = this.gl.getProgramInfoLog(program) || "Unknown program link error";
      this.gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  private createBuffer(data: Float32Array) {
    const buffer = this.gl.createBuffer();
    if (!buffer) throw new Error("Unable to create WebGL buffer");
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
    return buffer;
  }

  private createTexture() {
    const texture = this.gl.createTexture();
    if (!texture) throw new Error("Unable to create WebGL texture");
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    return texture;
  }

  private allocateFramebuffer(
    width: number,
    height: number,
    type: number,
  ): Framebuffer | undefined {
    const texture = this.createTexture();
    const framebuffer = this.gl.createFramebuffer();
    if (!framebuffer) throw new Error("Unable to create WebGL framebuffer");
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      type,
      null,
    );
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0,
    );
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      this.gl.deleteFramebuffer(framebuffer);
      this.gl.deleteTexture(texture);
      return undefined;
    }
    return { framebuffer, texture, width, height };
  }

  private createFramebuffer(
    width: number,
    height: number,
    preferHighPrecision = false,
  ): Framebuffer {
    if (preferHighPrecision && this.halfFloatExt && this.supportsHalfFloatFramebuffer) {
      const framebuffer = this.allocateFramebuffer(width, height, this.halfFloatExt.HALF_FLOAT_OES);
      if (framebuffer) return framebuffer;
    }
    const framebuffer = this.allocateFramebuffer(width, height, this.gl.UNSIGNED_BYTE);
    if (!framebuffer) throw new Error("WebGL framebuffer is incomplete");
    return framebuffer;
  }

  private deleteFramebuffer(framebuffer: Framebuffer) {
    this.gl.deleteFramebuffer(framebuffer.framebuffer);
    this.gl.deleteTexture(framebuffer.texture);
  }

  private setupAttributes() {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, 0, 0);
  }

  private uniform(program: string, name: string) {
    return this.gl.getUniformLocation(this.programs[program], name);
  }

  private copyTexture(sourceTexture: WebGLTexture, target: Framebuffer) {
    this.gl.useProgram(this.programs.blur);
    this.setupAttributes();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
    this.gl.viewport(0, 0, target.width, target.height);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, sourceTexture);
    this.gl.uniform1i(this.uniform("blur", "u_texture"), 0);
    this.gl.uniform2f(this.uniform("blur", "u_resolution"), target.width, target.height);
    this.gl.uniform1f(this.uniform("blur", "u_offset"), 0);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  private blurSourceInto(target: Framebuffer) {
    this.gl.useProgram(this.programs.tint);
    this.setupAttributes();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.blurFBO1.framebuffer);
    this.gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.uniform1i(this.uniform("tint", "u_texture"), 0);
    this.gl.uniform3fv(this.uniform("tint", "u_tintColor"), TINT_COLOR);
    this.gl.uniform1f(this.uniform("tint", "u_tintIntensity"), 0.15);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    this.gl.useProgram(this.programs.blur);
    this.setupAttributes();
    this.gl.uniform2f(this.uniform("blur", "u_resolution"), BLUR_SIZE, BLUR_SIZE);
    this.gl.uniform1i(this.uniform("blur", "u_texture"), 0);
    let read = this.blurFBO1;
    let write = this.blurFBO2;
    for (let index = 0; index < BLUR_PASSES; index += 1) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, write.framebuffer);
      this.gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, read.texture);
      this.gl.uniform1f(this.uniform("blur", "u_offset"), index + 0.5);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
      [read, write] = [write, read];
    }
    this.copyTexture(read.texture, target);
  }

  private transitionFactor(now: number) {
    const linear = Math.max(0, Math.min(1, (now - this.transitionStartTime) / TRANSITION_DURATION));
    return 1 - (1 - linear) ** 3;
  }

  private blendInto(target: Framebuffer, from: WebGLTexture, to: WebGLTexture, factor: number) {
    this.gl.useProgram(this.programs.blend);
    this.setupAttributes();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
    this.gl.viewport(0, 0, target.width, target.height);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, from);
    this.gl.uniform1i(this.uniform("blend", "u_texture1"), 0);
    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, to);
    this.gl.uniform1i(this.uniform("blend", "u_texture2"), 1);
    this.gl.uniform1f(this.uniform("blend", "u_blend"), Math.max(0, Math.min(1, factor)));
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  private captureInterruptedTransition() {
    if (!this.isTransitioning) return;
    this.blendInto(
      this.snapshotAlbumFBO,
      this.currentAlbumFBO.texture,
      this.nextAlbumFBO.texture,
      this.transitionFactor(performance.now()),
    );
    const oldCurrent = this.currentAlbumFBO;
    this.currentAlbumFBO = this.snapshotAlbumFBO;
    this.snapshotAlbumFBO = this.nextAlbumFBO;
    this.nextAlbumFBO = oldCurrent;
    this.isTransitioning = false;
  }

  private commitTransition() {
    if (!this.isTransitioning) return;
    [this.currentAlbumFBO, this.nextAlbumFBO] = [this.nextAlbumFBO, this.currentAlbumFBO];
    this.isTransitioning = false;
  }

  loadImage(image: HTMLImageElement) {
    if (this.contextLost) return false;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      image,
    );
    if (!this.hasCurrent) {
      this.blurSourceInto(this.currentAlbumFBO);
      this.copyTexture(this.currentAlbumFBO.texture, this.nextAlbumFBO);
      this.hasCurrent = true;
      this.renderFrame();
      return true;
    }
    this.captureInterruptedTransition();
    this.blurSourceInto(this.nextAlbumFBO);
    this.transitionStartTime = performance.now();
    this.isTransitioning = true;
    this.start();
    return true;
  }

  resizeToDisplaySize() {
    if (this.contextLost) return false;
    const cssWidth = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth));
    const cssHeight = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight));
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    let width = Math.round(cssWidth * dpr * 0.96);
    let height = Math.round(cssHeight * dpr * 0.96);
    const longEdge = Math.max(width, height);
    if (longEdge > 2560) {
      width = Math.max(1, Math.round((width * 2560) / longEdge));
      height = Math.max(1, Math.round((height * 2560) / longEdge));
    }
    if (width === this.renderWidth && height === this.renderHeight) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderWidth = width;
    this.renderHeight = height;
    this.deleteFramebuffer(this.warpFBO);
    this.warpFBO = this.createFramebuffer(width, height);
    return true;
  }

  private render(time: number, timestamp: number) {
    if (this.contextLost || !this.hasCurrent) return;
    this.resizeToDisplaySize();
    const width = this.renderWidth;
    const height = this.renderHeight;
    let source = this.currentAlbumFBO.texture;
    if (this.isTransitioning) {
      const linear = Math.max(
        0,
        Math.min(1, (timestamp - this.transitionStartTime) / TRANSITION_DURATION),
      );
      if (linear >= 1) {
        this.commitTransition();
        source = this.currentAlbumFBO.texture;
      } else {
        this.blendInto(
          this.blendScratchFBO,
          this.currentAlbumFBO.texture,
          this.nextAlbumFBO.texture,
          1 - (1 - linear) ** 3,
        );
        source = this.blendScratchFBO.texture;
      }
    }

    this.gl.useProgram(this.programs.warp);
    this.setupAttributes();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.warpFBO.framebuffer);
    this.gl.viewport(0, 0, width, height);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, source);
    this.gl.uniform1i(this.uniform("warp", "u_texture"), 0);
    this.gl.uniform1f(this.uniform("warp", "u_time"), time);
    this.gl.uniform1f(this.uniform("warp", "u_intensity"), 1);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    this.gl.useProgram(this.programs.output);
    this.setupAttributes();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, width, height);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.warpFBO.texture);
    this.gl.uniform1i(this.uniform("output", "u_texture"), 0);
    this.gl.uniform1f(this.uniform("output", "u_saturation"), 1.7);
    this.gl.uniform1f(this.uniform("output", "u_dithering"), 0);
    this.gl.uniform1f(this.uniform("output", "u_time"), time);
    this.gl.uniform1f(this.uniform("output", "u_scale"), 1);
    this.gl.uniform2f(this.uniform("output", "u_resolution"), width, height);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  renderFrame() {
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.accumulatedTime += dt * 1.8;
    this.render(this.accumulatedTime, now);
  }

  private readonly renderLoop = (timestamp: number) => {
    if (!this.isPlaying || this.contextLost) return;
    const dt = Math.max(0, Math.min(0.1, (timestamp - this.lastFrameTime) / 1000));
    this.lastFrameTime = timestamp;
    this.accumulatedTime += dt * 1.8;
    this.render(this.accumulatedTime, timestamp);
    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  start() {
    if (this.isPlaying || this.contextLost || !this.hasCurrent) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(this.renderLoop);
  }

  stop() {
    this.isPlaying = false;
    cancelAnimationFrame(this.animationId);
    this.animationId = 0;
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored, false);
    Object.values(this.programs).forEach((program) => this.gl.deleteProgram(program));
    this.gl.deleteBuffer(this.positionBuffer);
    this.gl.deleteBuffer(this.texCoordBuffer);
    this.gl.deleteTexture(this.sourceTexture);
    [
      this.blurFBO1,
      this.blurFBO2,
      this.currentAlbumFBO,
      this.nextAlbumFBO,
      this.snapshotAlbumFBO,
      this.blendScratchFBO,
      this.warpFBO,
    ].forEach((framebuffer) => this.deleteFramebuffer(framebuffer));
  }
}

const canvas = ref<HTMLCanvasElement>();
const renderer = shallowRef<DynamicBackgroundRenderer>();
const fallbackCover = ref(props.album || DEFAULT_COVER);
const fallbackLayers = reactive([
  { source: fallbackCover.value, active: true },
  { source: "", active: false },
]);
const webglReady = ref(false);
let imageRequest = 0;
let fallbackLayerIndex = 0;
let fallbackSwitchToken = 0;

const updatePlayback = () => {
  if (!renderer.value) return;
  if (
    props.playing &&
    !document.hidden &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    renderer.value.start();
  } else {
    renderer.value.stop();
  }
};

const createRenderer = () => {
  if (!canvas.value) return;
  renderer.value?.dispose();
  webglReady.value = false;
  renderer.value = new DynamicBackgroundRenderer(canvas.value, {
    onContextLost: () => {
      webglReady.value = false;
    },
    onContextRestored: () => {
      createRenderer();
      void loadArtwork(fallbackCover.value);
    },
  });
};

const setFallbackArtwork = (source: string) => {
  if (fallbackLayers[fallbackLayerIndex].source === source) return;
  const token = ++fallbackSwitchToken;
  const nextLayerIndex = fallbackLayerIndex === 0 ? 1 : 0;
  fallbackLayers[nextLayerIndex].source = source;
  requestAnimationFrame(() => {
    if (token !== fallbackSwitchToken) return;
    fallbackLayers[nextLayerIndex].active = true;
    fallbackLayers[fallbackLayerIndex].active = false;
    fallbackLayerIndex = nextLayerIndex;
  });
};

const loadArtwork = async (source: string) => {
  const request = ++imageRequest;
  fallbackCover.value = source || DEFAULT_COVER;
  const image = new Image();
  image.decoding = "async";
  image.src = fallbackCover.value;
  try {
    await image.decode();
  } catch {
    if (!image.complete || image.naturalWidth === 0) return;
  }
  if (request !== imageRequest || !renderer.value) return;
  setFallbackArtwork(fallbackCover.value);
  try {
    if (renderer.value.loadImage(image)) {
      webglReady.value = true;
      updatePlayback();
    }
  } catch {
    webglReady.value = false;
  }
};

const handleVisibilityChange = () => updatePlayback();
let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  try {
    createRenderer();
    resizeObserver = new ResizeObserver(() => renderer.value?.renderFrame());
    if (canvas.value) resizeObserver.observe(canvas.value);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void loadArtwork(props.album || DEFAULT_COVER);
  } catch {
    webglReady.value = false;
  }
});

watch(
  () => props.album,
  (album) => void loadArtwork(album || DEFAULT_COVER),
);
watch(() => props.playing, updatePlayback);

onBeforeUnmount(() => {
  imageRequest += 1;
  fallbackSwitchToken += 1;
  resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  renderer.value?.dispose();
  renderer.value = undefined;
  fallbackLayers.forEach((layer) => {
    layer.source = "";
    layer.active = false;
  });
});
</script>

<template>
  <div class="dynamic-background" :class="{ 'is-ready': webglReady }">
    <div
      v-for="(layer, index) in fallbackLayers"
      :key="index"
      class="dynamic-fallback"
      :class="{ active: layer.active }"
      :style="{ backgroundImage: `url(${JSON.stringify(layer.source)})` }"
    />
    <canvas ref="canvas" class="dynamic-canvas" aria-hidden="true" />
    <div class="dynamic-shade" aria-hidden="true" />
  </div>
</template>

<style scoped>
.dynamic-background,
.dynamic-fallback,
.dynamic-canvas,
.dynamic-shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.dynamic-background {
  overflow: hidden;
  background: rgb(20, 20, 28);
}

.dynamic-fallback {
  inset: -12%;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: blur(60px) saturate(1.5) brightness(0.52);
  opacity: 0;
  transform: scale(1.2);
  transition: opacity 220ms cubic-bezier(0.16, 0.84, 0.2, 1);
}

.dynamic-fallback.active {
  opacity: 0.88;
}

.dynamic-canvas {
  opacity: 0;
  transition: opacity 100ms linear;
}

.dynamic-background.is-ready .dynamic-canvas {
  opacity: 0.75;
}

.dynamic-background.is-ready .dynamic-fallback {
  display: none;
}

.dynamic-shade {
  background:
    radial-gradient(
      ellipse 112% 96% at 50% 43%,
      rgba(0, 0, 0, 0.14) 0%,
      rgba(0, 0, 0, 0.2) 54%,
      rgba(0, 0, 0, 0.46) 100%
    ),
    linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.1) 0%,
      rgba(0, 0, 0, 0.07) 46%,
      rgba(0, 0, 0, 0.36) 100%
    );
}
</style>
