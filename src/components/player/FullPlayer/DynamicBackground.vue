<script setup lang="ts">
/*
 * Dynamic background renderer adapted from Jellyfin LyricMotion's
 * DynamicBackgroundRenderer. Its upstream notices identify the MIT-licensed
 * Kawarp renderer and Dynamic Background theme; see THIRD_PARTY_NOTICES.md.
 */
import DEFAULT_COVER from "@/assets/images/song.jpg";
import type { DynamicBackgroundPreset } from "@/types/settings";

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

type TransitionProfile = "normal" | "skip";

interface DynamicPresetConfig {
  warpIntensity: number;
  animationSpeed: number;
  saturation: number;
  grain: number;
  vignette: number;
  canvasOpacity: number;
  focalDim: number;
  edgeColor: number;
}

interface ArtworkProfile {
  primary: [number, number, number];
  secondary: [number, number, number];
  tint: Float32Array;
  tintIntensity: number;
  saturation: number;
  exposure: number;
  shadowLift: number;
  focalDim: number;
  edgeColorStrength: number;
}

const props = defineProps<{
  album: string;
  playing: boolean;
  lyricFocus: number;
  transitionProfile: TransitionProfile;
  preset: DynamicBackgroundPreset;
}>();

const BLUR_SIZE = 128;
const BLUR_PASSES = 8;
const NORMAL_TRANSITION_HOLD = 100;
const NORMAL_TRANSITION_DURATION = 560;
const SKIP_TRANSITION_DURATION = 180;
const DEFAULT_PROFILE: ArtworkProfile = {
  primary: [82, 91, 148],
  secondary: [155, 79, 132],
  tint: new Float32Array([0.157, 0.157, 0.235]),
  tintIntensity: 0.2,
  saturation: 1.55,
  exposure: 1,
  shadowLift: 0.1,
  focalDim: 0.34,
  edgeColorStrength: 0.11,
};
const DYNAMIC_PRESETS: Record<DynamicBackgroundPreset, DynamicPresetConfig> = {
  balanced: {
    warpIntensity: 1,
    animationSpeed: 1.8,
    saturation: 1,
    grain: 0.012,
    vignette: 0.38,
    canvasOpacity: 0.75,
    focalDim: 1,
    edgeColor: 1,
  },
  immersive: {
    warpIntensity: 1.28,
    animationSpeed: 2.35,
    saturation: 1.12,
    grain: 0.014,
    vignette: 0.3,
    canvasOpacity: 0.82,
    focalDim: 0.78,
    edgeColor: 1.35,
  },
  focus: {
    warpIntensity: 0.45,
    animationSpeed: 0.75,
    saturation: 0.88,
    grain: 0.008,
    vignette: 0.47,
    canvasOpacity: 0.68,
    focalDim: 1.34,
    edgeColor: 0.68,
  },
};

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
  uniform float u_exposure;
  uniform float u_shadowLift;
  uniform float u_vignette;
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
    float vignette = 1.0 - dot(center, center) * u_vignette;
    color.rgb *= vignette;
    color.rgb = mix(color.rgb, sqrt(max(color.rgb, vec3(0.0))), u_shadowLift);
    color.rgb *= u_exposure;
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
  private transitionHold = 0;
  private transitionDuration = SKIP_TRANSITION_DURATION;
  private contextLost = false;
  private renderWidth = 0;
  private renderHeight = 0;
  private currentProfile: ArtworkProfile = DEFAULT_PROFILE;
  private nextProfile: ArtworkProfile = DEFAULT_PROFILE;
  private visualPreset: DynamicPresetConfig = DYNAMIC_PRESETS.balanced;

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

  private blurSourceInto(target: Framebuffer, profile: ArtworkProfile) {
    this.gl.useProgram(this.programs.tint);
    this.setupAttributes();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.blurFBO1.framebuffer);
    this.gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.uniform1i(this.uniform("tint", "u_texture"), 0);
    this.gl.uniform3fv(this.uniform("tint", "u_tintColor"), profile.tint);
    this.gl.uniform1f(this.uniform("tint", "u_tintIntensity"), profile.tintIntensity);
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
    const linear = this.transitionLinearFactor(now);
    return 1 - (1 - linear) ** 3;
  }

  private transitionLinearFactor(now: number) {
    const elapsed = Math.max(0, now - this.transitionStartTime - this.transitionHold);
    return Math.max(0, Math.min(1, elapsed / this.transitionDuration));
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
    const factor = this.transitionFactor(performance.now());
    this.blendInto(
      this.snapshotAlbumFBO,
      this.currentAlbumFBO.texture,
      this.nextAlbumFBO.texture,
      factor,
    );
    const oldCurrent = this.currentAlbumFBO;
    this.currentAlbumFBO = this.snapshotAlbumFBO;
    this.snapshotAlbumFBO = this.nextAlbumFBO;
    this.nextAlbumFBO = oldCurrent;
    this.currentProfile = this.mixProfile(this.currentProfile, this.nextProfile, factor);
    this.isTransitioning = false;
  }

  private commitTransition() {
    if (!this.isTransitioning) return;
    [this.currentAlbumFBO, this.nextAlbumFBO] = [this.nextAlbumFBO, this.currentAlbumFBO];
    this.currentProfile = this.nextProfile;
    this.isTransitioning = false;
  }

  private mixProfile(from: ArtworkProfile, to: ArtworkProfile, factor: number): ArtworkProfile {
    const mix = (a: number, b: number) => a + (b - a) * factor;
    return {
      primary: from.primary.map((value, index) =>
        Math.round(mix(value, to.primary[index])),
      ) as ArtworkProfile["primary"],
      secondary: from.secondary.map((value, index) =>
        Math.round(mix(value, to.secondary[index])),
      ) as ArtworkProfile["secondary"],
      tint: new Float32Array(from.tint.map((value, index) => mix(value, to.tint[index]))),
      tintIntensity: mix(from.tintIntensity, to.tintIntensity),
      saturation: mix(from.saturation, to.saturation),
      exposure: mix(from.exposure, to.exposure),
      shadowLift: mix(from.shadowLift, to.shadowLift),
      focalDim: mix(from.focalDim, to.focalDim),
      edgeColorStrength: mix(from.edgeColorStrength, to.edgeColorStrength),
    };
  }

  loadImage(
    image: HTMLImageElement,
    profile: ArtworkProfile,
    transitionProfile: TransitionProfile,
  ) {
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
      this.blurSourceInto(this.currentAlbumFBO, profile);
      this.copyTexture(this.currentAlbumFBO.texture, this.nextAlbumFBO);
      this.currentProfile = profile;
      this.nextProfile = profile;
      this.hasCurrent = true;
      this.renderFrame();
      return true;
    }
    this.captureInterruptedTransition();
    this.blurSourceInto(this.nextAlbumFBO, profile);
    this.nextProfile = profile;
    this.transitionStartTime = performance.now();
    this.transitionHold = transitionProfile === "normal" ? NORMAL_TRANSITION_HOLD : 0;
    this.transitionDuration =
      transitionProfile === "normal" ? NORMAL_TRANSITION_DURATION : SKIP_TRANSITION_DURATION;
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
    let profile = this.currentProfile;
    if (this.isTransitioning) {
      const linear = this.transitionLinearFactor(timestamp);
      if (linear >= 1) {
        this.commitTransition();
        source = this.currentAlbumFBO.texture;
        profile = this.currentProfile;
      } else {
        this.blendInto(
          this.blendScratchFBO,
          this.currentAlbumFBO.texture,
          this.nextAlbumFBO.texture,
          1 - (1 - linear) ** 3,
        );
        source = this.blendScratchFBO.texture;
        profile = this.mixProfile(this.currentProfile, this.nextProfile, 1 - (1 - linear) ** 3);
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
    this.gl.uniform1f(this.uniform("warp", "u_intensity"), this.visualPreset.warpIntensity);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    this.gl.useProgram(this.programs.output);
    this.setupAttributes();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, width, height);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.warpFBO.texture);
    this.gl.uniform1i(this.uniform("output", "u_texture"), 0);
    this.gl.uniform1f(
      this.uniform("output", "u_saturation"),
      profile.saturation * this.visualPreset.saturation,
    );
    this.gl.uniform1f(this.uniform("output", "u_dithering"), this.visualPreset.grain);
    this.gl.uniform1f(this.uniform("output", "u_exposure"), profile.exposure);
    this.gl.uniform1f(this.uniform("output", "u_shadowLift"), profile.shadowLift);
    this.gl.uniform1f(this.uniform("output", "u_vignette"), this.visualPreset.vignette);
    this.gl.uniform1f(this.uniform("output", "u_time"), time);
    this.gl.uniform1f(this.uniform("output", "u_scale"), 1);
    this.gl.uniform2f(this.uniform("output", "u_resolution"), width, height);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  renderFrame() {
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.accumulatedTime += dt * this.visualPreset.animationSpeed;
    this.render(this.accumulatedTime, now);
  }

  private readonly renderLoop = (timestamp: number) => {
    if (!this.isPlaying || this.contextLost) return;
    const dt = Math.max(0, Math.min(0.1, (timestamp - this.lastFrameTime) / 1000));
    this.lastFrameTime = timestamp;
    this.accumulatedTime += dt * this.visualPreset.animationSpeed;
    this.render(this.accumulatedTime, timestamp);
    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  start() {
    if (this.isPlaying || this.contextLost || !this.hasCurrent) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(this.renderLoop);
  }

  setPreset(preset: DynamicBackgroundPreset) {
    this.visualPreset = DYNAMIC_PRESETS[preset];
    this.renderFrame();
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

interface PaletteBucket {
  count: number;
  red: number;
  green: number;
  blue: number;
  saturation: number;
  hue: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const luminance = (red: number, green: number, blue: number) =>
  (red * 0.299 + green * 0.587 + blue * 0.114) / 255;

const rgbToHsv = (red: number, green: number, blue: number) => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return { hue, saturation: maximum === 0 ? 0 : delta / maximum };
};

const profileFromImage = (image: HTMLImageElement): ArtworkProfile => {
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = 48;
  analysisCanvas.height = 48;
  const context = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return DEFAULT_PROFILE;

  try {
    context.drawImage(image, 0, 0, analysisCanvas.width, analysisCanvas.height);
    const pixels = context.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height).data;
    const buckets = new Map<string, PaletteBucket>();
    let sampledPixels = 0;
    let totalLuminance = 0;
    let totalSaturation = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 128) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const brightness = luminance(red, green, blue);
      const { hue, saturation } = rgbToHsv(red, green, blue);
      const hueBucket = Math.floor(hue * 12);
      const saturationBucket = Math.min(3, Math.floor(saturation * 4));
      const luminanceBucket = Math.min(3, Math.floor(brightness * 4));
      const key = `${hueBucket}:${saturationBucket}:${luminanceBucket}`;
      const bucket = buckets.get(key) ?? {
        count: 0,
        red: 0,
        green: 0,
        blue: 0,
        saturation: 0,
        hue: 0,
      };
      bucket.count += 1;
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      bucket.saturation += saturation;
      bucket.hue += hue;
      buckets.set(key, bucket);
      sampledPixels += 1;
      totalLuminance += brightness;
      totalSaturation += saturation;
    }

    if (sampledPixels === 0) return DEFAULT_PROFILE;
    const candidates = [...buckets.values()]
      .map((bucket) => ({
        color: [
          Math.round(bucket.red / bucket.count),
          Math.round(bucket.green / bucket.count),
          Math.round(bucket.blue / bucket.count),
        ] as ArtworkProfile["primary"],
        saturation: bucket.saturation / bucket.count,
        hue: bucket.hue / bucket.count,
        score: bucket.count * (0.35 + (bucket.saturation / bucket.count) * 0.65),
      }))
      .sort((left, right) => right.score - left.score);
    const primary =
      candidates.find((candidate) => candidate.saturation >= 0.12)?.color ??
      candidates.find((candidate) => luminance(...candidate.color) >= 0.08)?.color ??
      DEFAULT_PROFILE.primary;
    const primaryHue = rgbToHsv(...primary).hue;
    const secondary =
      candidates.find((candidate) => {
        const distance = Math.abs(candidate.hue - primaryHue);
        return candidate.saturation >= 0.12 && Math.min(distance, 1 - distance) >= 0.1;
      })?.color ?? primary;
    const averageLuminance = totalLuminance / sampledPixels;
    const averageSaturation = totalSaturation / sampledPixels;
    const brightCover = clamp((averageLuminance - 0.48) / 0.52, 0, 1);
    const darkCover = clamp((0.32 - averageLuminance) / 0.32, 0, 1);
    const tint = primary.map((value) => clamp((value / 255) * 0.68 + 0.055, 0, 1));

    return {
      primary,
      secondary,
      tint: new Float32Array(tint),
      tintIntensity: 0.14 + darkCover * 0.15,
      saturation: clamp(1.42 + averageSaturation * 0.3 - brightCover * 0.08, 1.35, 1.72),
      exposure: 1 - brightCover * 0.18 + darkCover * 0.1,
      shadowLift: 0.035 + darkCover * 0.14,
      focalDim: 0.28 + brightCover * 0.24 - darkCover * 0.06,
      edgeColorStrength: 0.07 + averageSaturation * 0.1,
    };
  } catch {
    return DEFAULT_PROFILE;
  }
};

const canvas = ref<HTMLCanvasElement>();
const renderer = shallowRef<DynamicBackgroundRenderer>();
const fallbackCover = ref(props.album || DEFAULT_COVER);
const fallbackLayers = reactive([
  { source: fallbackCover.value, active: true },
  { source: "", active: false },
]);
const artworkProfile = shallowRef<ArtworkProfile>(DEFAULT_PROFILE);
const webglReady = ref(false);
let imageRequest = 0;
let fallbackLayerIndex = 0;
let fallbackSwitchToken = 0;
let pendingTransitionProfile: TransitionProfile | undefined;

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

const visualPreset = computed(() => DYNAMIC_PRESETS[props.preset]);
const rootStyle = computed(() => ({
  "--dynamic-canvas-opacity": visualPreset.value.canvasOpacity.toFixed(3),
}));

const compositionStyle = computed(() => {
  const profile = artworkProfile.value;
  const preset = visualPreset.value;
  return {
    "--dynamic-primary": profile.primary.join(", "),
    "--dynamic-secondary": profile.secondary.join(", "),
    "--dynamic-focus-x": `${clamp(props.lyricFocus, 0, 100)}%`,
    "--dynamic-focal-dim": (profile.focalDim * preset.focalDim).toFixed(3),
    "--dynamic-edge-color": (profile.edgeColorStrength * preset.edgeColor).toFixed(3),
  };
});

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
  renderer.value.setPreset(props.preset);
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

const loadWebglImage = async (
  source: string,
): Promise<{ image: HTMLImageElement; release: () => void }> => {
  let objectUrl: string | undefined;
  if (/^(https?|cache|streaming-cover):\/\//i.test(source)) {
    const result = await window.api.system.fetchImageBytes(source);
    if (result.success && result.data) {
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)]));
    }
  }
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl ?? source;
  try {
    await image.decode();
  } catch {
    if (!image.complete || image.naturalWidth === 0) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      throw new Error("Unable to decode dynamic background artwork");
    }
  }
  return {
    image,
    release: () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  };
};

const loadArtwork = async (source: string) => {
  const request = ++imageRequest;
  fallbackCover.value = source || DEFAULT_COVER;
  setFallbackArtwork(fallbackCover.value);
  try {
    const { image, release } = await loadWebglImage(fallbackCover.value);
    if (request !== imageRequest || !renderer.value) {
      release();
      return;
    }
    const profile = profileFromImage(image);
    artworkProfile.value = profile;
    try {
      if (
        renderer.value.loadImage(
          image,
          profile,
          pendingTransitionProfile ?? props.transitionProfile,
        )
      ) {
        pendingTransitionProfile = undefined;
        webglReady.value = true;
        updatePlayback();
      }
    } catch {
      webglReady.value = false;
    } finally {
      release();
    }
  } catch {
    webglReady.value = false;
  }
};

const handleVisibilityChange = () => updatePlayback();
const handleTrackTransition = (event: Event) => {
  const profile = (event as CustomEvent<TransitionProfile>).detail;
  if (profile === "normal" || profile === "skip") pendingTransitionProfile = profile;
};
let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  try {
    createRenderer();
    resizeObserver = new ResizeObserver(() => renderer.value?.renderFrame());
    if (canvas.value) resizeObserver.observe(canvas.value);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("splayer:track-transition", handleTrackTransition);
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
watch(
  () => props.preset,
  (preset) => renderer.value?.setPreset(preset),
);

onBeforeUnmount(() => {
  imageRequest += 1;
  fallbackSwitchToken += 1;
  resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("splayer:track-transition", handleTrackTransition);
  renderer.value?.dispose();
  renderer.value = undefined;
  fallbackLayers.forEach((layer) => {
    layer.source = "";
    layer.active = false;
  });
});
</script>

<template>
  <div
    class="dynamic-background"
    :class="{ 'is-ready': webglReady }"
    :style="[rootStyle, compositionStyle]"
  >
    <div
      v-for="(layer, index) in fallbackLayers"
      :key="index"
      class="dynamic-fallback"
      :class="{ active: layer.active }"
      :style="{ backgroundImage: `url(${JSON.stringify(layer.source)})` }"
    />
    <canvas ref="canvas" class="dynamic-canvas" aria-hidden="true" />
    <div class="dynamic-composition" aria-hidden="true" />
  </div>
</template>

<style scoped>
.dynamic-background,
.dynamic-fallback,
.dynamic-canvas,
.dynamic-composition {
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
  opacity: var(--dynamic-canvas-opacity);
}

.dynamic-background.is-ready .dynamic-fallback {
  display: none;
}

.dynamic-composition {
  background:
    radial-gradient(
      ellipse 54% 108% at var(--dynamic-focus-x) 49%,
      rgba(0, 0, 0, var(--dynamic-focal-dim)) 0%,
      rgba(0, 0, 0, calc(var(--dynamic-focal-dim) * 0.68)) 48%,
      transparent 76%
    ),
    radial-gradient(ellipse 90% 94% at 50% 43%, transparent 42%, rgba(0, 0, 0, 0.3) 100%),
    linear-gradient(
      112deg,
      rgba(var(--dynamic-primary), var(--dynamic-edge-color)) 0%,
      transparent 36%,
      transparent 64%,
      rgba(var(--dynamic-secondary), var(--dynamic-edge-color)) 100%
    ),
    linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.1) 0%,
      rgba(0, 0, 0, 0.07) 46%,
      rgba(0, 0, 0, 0.36) 100%
    );
}
</style>
