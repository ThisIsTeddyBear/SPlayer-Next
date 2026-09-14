<script setup lang="ts">
import {
  analyzeOriginalBackground,
  getOriginalBackgroundQuality,
  getOriginalBackgroundTransitionDuration,
  normalizeRgb,
  type OriginalBackgroundPalette,
} from "@/utils/originalBackground";

export interface OriginalBackgroundProps {
  album?: string;
  playing?: boolean;
}

const props = withDefaults(defineProps<OriginalBackgroundProps>(), {
  playing: false,
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
const visible = ref(document.visibilityState === "visible");
const reducedMotion = usePreferredReducedMotion();
const contrastQuery = window.matchMedia("(prefers-contrast: more)");
const highContrast = ref(contrastQuery.matches);

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
uniform float uTime;
uniform float uTransition;
uniform float uAspect;
uniform vec2 uResolution;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform float uExposure;
uniform float uSaturation;
uniform float uOverlayOpacity;

float noise(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float smoothNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(noise(cell), noise(cell + vec2(1.0, 0.0)), local.x),
    mix(noise(cell + vec2(0.0, 1.0)), noise(cell + vec2(1.0, 1.0)), local.x),
    local.y
  );
}

float field(vec2 point) {
  float value = 0.0;
  value += smoothNoise(point) * 0.55;
  value += smoothNoise(point * 2.03) * 0.28;
  value += smoothNoise(point * 4.11) * 0.17;
  return value;
}

vec2 deform(vec2 uv, float time) {
  vec2 point = uv - 0.5;
  point.x *= uAspect;
  float drift = time * 0.055;
  float x = field(point * 2.2 + vec2(drift, -drift * 0.7));
  float y = field(point * 2.2 + vec2(-drift * 0.65, drift));
  vec2 offset = vec2(x - 0.5, y - 0.5) * 0.19;
  offset.x /= uAspect;
  return clamp(uv + offset, 0.04, 0.96);
}

vec3 sampleArtwork(sampler2D artwork, vec2 uv, float time) {
  vec2 point = deform(uv, time);
  vec2 blur = vec2(0.008, 0.008 / uAspect);
  vec3 color = texture2D(artwork, point).rgb * 0.36;
  color += texture2D(artwork, point + vec2(blur.x, 0.0)).rgb * 0.16;
  color += texture2D(artwork, point - vec2(blur.x, 0.0)).rgb * 0.16;
  color += texture2D(artwork, point + vec2(0.0, blur.y)).rgb * 0.16;
  color += texture2D(artwork, point - vec2(0.0, blur.y)).rgb * 0.16;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);
  color *= uExposure;
  return color;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 current = sampleArtwork(uCurrent, uv, uTime);
  vec3 previous = sampleArtwork(uPrevious, uv, uTime);
  vec3 color = mix(previous, current, uTransition);
  vec2 palettePoint = (uv - 0.5) * vec2(uAspect, 1.0);
  float paletteMix = field(palettePoint * 1.3 + uTime * 0.025) * 0.65 + 0.18;
  vec3 palette = mix(uPrimary, uSecondary, paletteMix);
  color = mix(color, palette, 0.2);
  vec2 distance = uv - 0.5;
  distance.x *= uAspect;
  float vignette = 1.0 - smoothstep(0.2, 0.95, length(distance));
  color *= 1.0 - uOverlayOpacity + vignette * 0.24;
  gl_FragColor = vec4(color, 1.0);
}`;

type Renderer = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  position: WebGLBuffer;
  current: WebGLTexture;
  previous: WebGLTexture;
  currentLocation: WebGLUniformLocation;
  previousLocation: WebGLUniformLocation;
  timeLocation: WebGLUniformLocation;
  transitionLocation: WebGLUniformLocation;
  aspectLocation: WebGLUniformLocation;
  resolutionLocation: WebGLUniformLocation;
  primaryLocation: WebGLUniformLocation;
  secondaryLocation: WebGLUniformLocation;
  exposureLocation: WebGLUniformLocation;
  saturationLocation: WebGLUniformLocation;
  overlayOpacityLocation: WebGLUniformLocation;
  positionLocation: number;
  palette: OriginalBackgroundPalette;
  sceneTime: number;
  lastFrameAt: number;
  lastRenderAt: number;
  lastAlbumAt: number;
  transitionDuration: number;
  maxFps: number;
  transitionStartedAt: number;
  hasCurrent: boolean;
  hasPrevious: boolean;
};

let renderer: Renderer | undefined;
let animationFrame = 0;
let loadToken = 0;
let loadController: AbortController | undefined;

const getShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | undefined => {
  const shader = gl.createShader(type);
  if (!shader) return undefined;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return undefined;
};

const getProgram = (gl: WebGLRenderingContext): WebGLProgram | undefined => {
  const vertex = getShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = getShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return undefined;

  const program = gl.createProgram();
  if (!program) return undefined;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return undefined;
};

const createTexture = (gl: WebGLRenderingContext): WebGLTexture | undefined => {
  const texture = gl.createTexture();
  if (!texture) return undefined;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([10, 10, 14, 255]),
  );
  return texture;
};

const resize = () => {
  const canvas = canvasRef.value;
  const state = renderer;
  if (!canvas || !state) return;
  const quality = getOriginalBackgroundQuality(
    canvas.clientWidth,
    canvas.clientHeight,
    window.devicePixelRatio,
  );
  state.maxFps = quality.maxFps;
  const scale = quality.renderScale;
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  state.gl.viewport(0, 0, width, height);
};

const draw = (now: number, advance: boolean) => {
  const state = renderer;
  const canvas = canvasRef.value;
  if (!state || !canvas) return;

  resize();
  const { gl } = state;
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!state.hasCurrent) return;
  if (advance) state.sceneTime += Math.min(100, now - state.lastFrameAt) / 1000;
  state.lastFrameAt = now;
  const transition = state.hasPrevious
    ? Math.min(1, (now - state.transitionStartedAt) / state.transitionDuration)
    : 1;

  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.position);
  gl.enableVertexAttribArray(state.positionLocation);
  gl.vertexAttribPointer(state.positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.current);
  gl.uniform1i(state.currentLocation, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, state.previous);
  gl.uniform1i(state.previousLocation, 1);
  gl.uniform1f(state.timeLocation, state.sceneTime);
  gl.uniform1f(state.transitionLocation, transition * transition * (3 - 2 * transition));
  gl.uniform1f(state.aspectLocation, canvas.width / canvas.height);
  gl.uniform2f(state.resolutionLocation, canvas.width, canvas.height);
  const primary = normalizeRgb(state.palette.primary);
  const secondary = normalizeRgb(state.palette.secondary);
  gl.uniform3f(state.primaryLocation, primary[0], primary[1], primary[2]);
  gl.uniform3f(state.secondaryLocation, secondary[0], secondary[1], secondary[2]);
  gl.uniform1f(state.exposureLocation, state.palette.exposure);
  gl.uniform1f(state.saturationLocation, state.palette.saturation);
  gl.uniform1f(
    state.overlayOpacityLocation,
    Math.max(state.palette.overlayOpacity, highContrast.value ? 0.8 : 0),
  );
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(state.positionLocation);

  if (transition === 1) state.hasPrevious = false;
};

const syncAnimation = () => {
  cancelAnimationFrame(animationFrame);
  if (!renderer) return;
  const shouldAnimate = () => props.playing && visible.value && reducedMotion.value !== "reduce";
  const render = (now: number) => {
    const state = renderer;
    if (state && now - state.lastRenderAt >= 1000 / state.maxFps) {
      draw(now, true);
      state.lastRenderAt = now;
    }
    if (shouldAnimate()) animationFrame = requestAnimationFrame(render);
  };
  draw(performance.now(), false);
  if (shouldAnimate()) animationFrame = requestAnimationFrame(render);
};

const revealFallback = () => {
  if (!renderer) return;
  renderer.hasCurrent = false;
  renderer.hasPrevious = false;
  syncAnimation();
};

const uploadAlbum = async (source?: string) => {
  const state = renderer;
  if (!state || !source) return;
  const token = ++loadToken;
  loadController?.abort();
  loadController = new AbortController();
  const image = new Image();
  let objectUrl = "";

  try {
    const response = await fetch(source, { signal: loadController.signal });
    if (!response.ok) {
      if (token === loadToken) revealFallback();
      return;
    }
    objectUrl = URL.createObjectURL(await response.blob());
    image.src = objectUrl;
    await image.decode();
  } catch {
    if (token === loadToken) revealFallback();
    return;
  }
  if (token !== loadToken || !renderer) {
    URL.revokeObjectURL(objectUrl);
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    URL.revokeObjectURL(objectUrl);
    return;
  }
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  URL.revokeObjectURL(objectUrl);
  state.palette = analyzeOriginalBackground(
    context.getImageData(0, 0, canvas.width, canvas.height).data,
  );

  const { gl } = state;
  const texture = createTexture(gl);
  if (!texture) return;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  if (state.hasCurrent) {
    const snapshot = createTexture(gl);
    const frame = canvasRef.value;
    if (!snapshot || !frame) {
      gl.deleteTexture(texture);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, snapshot);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.deleteTexture(state.current);
    gl.deleteTexture(state.previous);
    state.previous = snapshot;
    state.hasPrevious = true;
  } else {
    gl.deleteTexture(state.current);
  }
  state.current = texture;
  state.hasCurrent = true;
  state.transitionDuration = getOriginalBackgroundTransitionDuration(
    performance.now() - state.lastAlbumAt,
  );
  state.lastAlbumAt = performance.now();
  state.transitionStartedAt = performance.now();
  syncAnimation();
};

const destroyRenderer = () => {
  cancelAnimationFrame(animationFrame);
  const state = renderer;
  if (!state) return;
  const { gl } = state;
  gl.deleteTexture(state.current);
  gl.deleteTexture(state.previous);
  gl.deleteBuffer(state.position);
  gl.deleteProgram(state.program);
  renderer = undefined;
};

const onVisibilityChange = () => {
  visible.value = document.visibilityState === "visible";
  syncAnimation();
};

const onContrastChange = (event: MediaQueryListEvent) => {
  highContrast.value = event.matches;
  syncAnimation();
};

const restoreRenderer = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  if (!gl) return;
  const program = getProgram(gl);
  const current = createTexture(gl);
  const previous = createTexture(gl);
  const position = gl.createBuffer();
  if (!program || !current || !previous || !position) return;

  const currentLocation = gl.getUniformLocation(program, "uCurrent");
  const previousLocation = gl.getUniformLocation(program, "uPrevious");
  const timeLocation = gl.getUniformLocation(program, "uTime");
  const transitionLocation = gl.getUniformLocation(program, "uTransition");
  const aspectLocation = gl.getUniformLocation(program, "uAspect");
  const resolutionLocation = gl.getUniformLocation(program, "uResolution");
  const primaryLocation = gl.getUniformLocation(program, "uPrimary");
  const secondaryLocation = gl.getUniformLocation(program, "uSecondary");
  const exposureLocation = gl.getUniformLocation(program, "uExposure");
  const saturationLocation = gl.getUniformLocation(program, "uSaturation");
  const overlayOpacityLocation = gl.getUniformLocation(program, "uOverlayOpacity");
  const positionLocation = gl.getAttribLocation(program, "aPosition");
  if (
    !currentLocation ||
    !previousLocation ||
    !timeLocation ||
    !transitionLocation ||
    !aspectLocation ||
    !resolutionLocation ||
    !primaryLocation ||
    !secondaryLocation ||
    !exposureLocation ||
    !saturationLocation ||
    !overlayOpacityLocation ||
    positionLocation < 0
  ) {
    return;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, position);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.clearColor(0, 0, 0, 0);
  renderer = {
    gl,
    program,
    position,
    current,
    previous,
    currentLocation,
    previousLocation,
    timeLocation,
    transitionLocation,
    aspectLocation,
    resolutionLocation,
    primaryLocation,
    secondaryLocation,
    exposureLocation,
    saturationLocation,
    overlayOpacityLocation,
    positionLocation,
    palette: analyzeOriginalBackground(new Uint8ClampedArray()),
    sceneTime: 0,
    lastFrameAt: performance.now(),
    lastRenderAt: 0,
    lastAlbumAt: 0,
    transitionDuration: 700,
    maxFps: 30,
    transitionStartedAt: 0,
    hasCurrent: false,
    hasPrevious: false,
  };
  uploadAlbum(props.album);
  syncAnimation();
};

const onContextLost = (event: Event) => {
  event.preventDefault();
  loadToken++;
  loadController?.abort();
  cancelAnimationFrame(animationFrame);
  renderer = undefined;
  canvasRef.value?.classList.add("is-unavailable");
};

const onContextRestored = () => {
  canvasRef.value?.classList.remove("is-unavailable");
  restoreRenderer();
};

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibilityChange);
  contrastQuery.addEventListener("change", onContrastChange);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  restoreRenderer();
});

onBeforeUnmount(() => {
  loadToken++;
  loadController?.abort();
  const canvas = canvasRef.value;
  window.removeEventListener("resize", resize);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  contrastQuery.removeEventListener("change", onContrastChange);
  canvas?.removeEventListener("webglcontextlost", onContextLost);
  canvas?.removeEventListener("webglcontextrestored", onContextRestored);
  destroyRenderer();
});

watch(
  () => props.album,
  (album) => uploadAlbum(album),
);

watch(
  () => props.playing,
  () => syncAnimation(),
);

watch(reducedMotion, () => syncAnimation());
</script>

<template>
  <canvas ref="canvasRef" class="original-background" aria-hidden="true" />
</template>

<style scoped>
.original-background {
  width: 100%;
  height: 100%;
  display: block;
}

.original-background.is-unavailable {
  opacity: 0;
}
</style>
