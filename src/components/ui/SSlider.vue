<script setup lang="ts">
export interface SSliderProps {
  modelValue?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  alwaysShowThumb?: boolean;
  showPopover?: boolean;
  popoverSide?: "top" | "bottom" | "left" | "right";
  popoverOffset?: number;
  trackHeight?: number;
  thumbSize?: number;
  marks?: Record<number, string>;
  vertical?: boolean;
  centerFill?: boolean;
  cover?: boolean;
}

const props = withDefaults(defineProps<SSliderProps>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  alwaysShowThumb: true,
  showPopover: true,
  popoverSide: "top",
  popoverOffset: 8,
  trackHeight: 4,
  thumbSize: 14,
  marks: undefined,
  vertical: false,
  centerFill: false,
  cover: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: number];
  change: [value: number];
  dragStart: [value: number];
  dragEnd: [value: number];
  dragCancel: [value: number];
}>();

const slots = defineSlots<{
  popover?(props: { value: number }): unknown;
}>();

interface PopoverShiftOptions {
  anchorX: number;
  contentWidth: number;
  viewportWidth: number;
  padding: number;
}

const computePopoverShift = ({
  anchorX,
  contentWidth,
  viewportWidth,
  padding,
}: PopoverShiftOptions): number => {
  const left = anchorX - contentWidth / 2;
  const right = anchorX + contentWidth / 2;
  const minLeft = padding;
  const maxRight = viewportWidth - padding;

  if (left < minLeft) return minLeft - left;
  if (right > maxRight) return maxRight - right;
  return 0;
};

const trackRef = ref<HTMLElement>();
const sliderRef = ref<HTMLElement>();
const popoverContentRef = ref<HTMLElement>();
const isDragging = ref(false);
const isHovering = ref(false);
const isThumbHovering = ref(false);
const isFocused = ref(false);
const dragValue = ref(props.modelValue);
const popoverShift = ref(0);
let popoverFrame = 0;
let activePointer: number | undefined;
let pointerStartValue = props.modelValue;

watch(
  () => props.modelValue,
  (val) => {
    if (!isDragging.value) dragValue.value = val;
  },
);

const displayValue = computed(() => (isDragging.value ? dragValue.value : props.modelValue));

const progressRatio = computed(() => {
  const range = props.max - props.min;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(1, (displayValue.value - props.min) / range));
});

const progressPercent = computed(() => `${Math.round(progressRatio.value * 10000) / 100}%`);

const popoverAnchorOffset = (width: number): number => {
  const min = 24;
  const max = Math.max(min, width - min);
  return Math.max(min, Math.min(progressRatio.value * width, max));
};

const centerFillStyle = computed(() => {
  const center = 0.5;
  const ratio = progressRatio.value;
  if (ratio >= center) {
    const len = (ratio - center) * 100;
    return { start: "50%", length: `${len}%` };
  }
  const len = (center - ratio) * 100;
  return { start: `${50 - len}%`, length: `${len}%` };
});

const thumbVisible = computed(
  () => props.alwaysShowThumb || isHovering.value || isDragging.value || isFocused.value,
);

const toPercent = (value: number): number =>
  props.max > props.min ? ((value - props.min) / (props.max - props.min)) * 100 : 0;

const onMarkClick = (value: number): void => {
  if (props.disabled) return;
  dragValue.value = value;
  emit("change", value);
  emit("update:modelValue", value);
};

const popoverVisible = computed(
  () => props.showPopover && (isThumbHovering.value || isDragging.value || isFocused.value),
);

const updatePopoverShift = (): void => {
  if (props.vertical || !popoverVisible.value) {
    popoverShift.value = 0;
    return;
  }

  if (popoverFrame) cancelAnimationFrame(popoverFrame);
  popoverFrame = requestAnimationFrame(() => {
    popoverFrame = 0;
    const slider = sliderRef.value;
    const content = popoverContentRef.value;
    if (!slider || !content) return;

    const rect = slider.getBoundingClientRect();
    popoverShift.value = computePopoverShift({
      anchorX: rect.left + popoverAnchorOffset(rect.width),
      contentWidth: content.offsetWidth,
      viewportWidth: window.innerWidth,
      padding: 8,
    });
  });
};

watch([popoverVisible, displayValue], updatePopoverShift, { flush: "post" });

onBeforeUnmount(() => {
  if (popoverFrame) cancelAnimationFrame(popoverFrame);
});

const stepDecimals = computed(() => {
  const str = String(props.step);
  const dot = str.indexOf(".");
  return dot < 0 ? 0 : str.length - dot - 1;
});

const calcValueFromEvent = (e: MouseEvent | TouchEvent): number => {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect || (props.vertical ? rect.height : rect.width) <= 0) return displayValue.value;
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  const ratio = props.vertical
    ? Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
    : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const rawValue = props.min + ratio * (props.max - props.min);
  const stepped = Math.round((rawValue - props.min) / props.step) * props.step + props.min;
  return Math.max(props.min, Math.min(props.max, parseFloat(stepped.toFixed(stepDecimals.value))));
};

const onPointerDown = (e: PointerEvent): void => {
  if (
    props.disabled ||
    e.button !== 0 ||
    isDragging.value ||
    props.max <= props.min ||
    props.step <= 0
  ) {
    return;
  }
  e.preventDefault();
  sliderRef.value?.focus();
  activePointer = e.pointerId;
  pointerStartValue = props.modelValue;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  isDragging.value = true;
  const value = calcValueFromEvent(e);
  dragValue.value = value;
  emit("change", value);
  emit("dragStart", value);
};

const onPointerMove = (e: PointerEvent): void => {
  if (!isDragging.value || e.pointerId !== activePointer) return;
  const value = calcValueFromEvent(e);
  dragValue.value = value;
  emit("change", value);
};

const onPointerUp = (event: PointerEvent): void => {
  if (!isDragging.value || event.pointerId !== activePointer) return;
  isDragging.value = false;
  activePointer = undefined;
  emit("update:modelValue", dragValue.value);
  emit("dragEnd", dragValue.value);
};

const onPointerCancel = (event?: PointerEvent): void => {
  if (event && event.pointerId !== activePointer) return;
  if (!isDragging.value) return;
  activePointer = undefined;
  dragValue.value = pointerStartValue;
  isDragging.value = false;
  emit("change", pointerStartValue);
  emit("update:modelValue", pointerStartValue);
  emit("dragCancel", pointerStartValue);
};

const onKeydown = (event: KeyboardEvent): void => {
  if (props.disabled || isDragging.value || props.max <= props.min || props.step <= 0) return;
  const increments: Record<string, number> = {
    ArrowRight: props.step,
    ArrowUp: props.step,
    ArrowLeft: -props.step,
    ArrowDown: -props.step,
    PageUp: props.step * 10,
    PageDown: -props.step * 10,
  };
  if (!(event.key in increments) && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  event.stopPropagation();
  const target =
    event.key === "Home"
      ? props.min
      : event.key === "End"
        ? props.max
        : displayValue.value + increments[event.key];
  const value = Math.max(props.min, Math.min(props.max, Number(target.toFixed(stepDecimals.value))));
  emit("dragStart", displayValue.value);
  emit("change", value);
  emit("update:modelValue", value);
  emit("dragEnd", value);
};

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) onPointerCancel();
  },
);
</script>

<template>
  <div
    ref="sliderRef"
    role="slider"
    :tabindex="disabled ? -1 : 0"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="displayValue"
    :aria-orientation="vertical ? 'vertical' : 'horizontal'"
    :aria-disabled="disabled"
    class="s-slider relative select-none"
    :class="[
      disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      vertical ? 'flex flex-col items-center h-full' : '',
    ]"
    :style="{
      '--s-slider-progress': progressPercent,
      '--s-slider-thumb-half': `${thumbSize / 2}px`,
    }"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
    @focus="isFocused = true"
    @blur="isFocused = false"
    @keydown="onKeydown"
  >
    <div
      v-if="!vertical"
      ref="trackRef"
      class="s-slider-hitbox relative flex items-center touch-none"
      :style="{ height: `${thumbSize}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onPointerCancel"
    >
      <div
        class="s-slider-track absolute left-0 right-0 rounded-full"
        :class="cover ? 'bg-cover/25' : 'bg-on-surface/12'"
        :style="{ height: `${trackHeight}px` }"
      />
      <div
        v-if="centerFill"
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 rounded-full bg-on-surface/20"
        :style="{ height: `${trackHeight + 6}px` }"
      />
      <div
        class="s-slider-fill absolute rounded-full"
        :class="cover ? 'bg-cover/100' : 'bg-primary'"
        :style="
          centerFill
            ? {
                height: `${trackHeight}px`,
                left: centerFillStyle.start,
                width: centerFillStyle.length,
              }
            : {
                height: `${trackHeight}px`,
                left: '0',
                width: 'var(--s-slider-progress)',
              }
        "
      />
      <div
        class="s-slider-thumb absolute rounded-full shadow-sm transition-[transform,opacity] duration-150"
        :class="[
          thumbVisible ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          cover ? 'bg-cover/100' : 'bg-primary',
        ]"
        :style="{
          width: `${thumbSize}px`,
          height: `${thumbSize}px`,
          left: 'clamp(calc(var(--s-slider-thumb-half) - 2px), var(--s-slider-progress), calc(100% - var(--s-slider-thumb-half) + 2px))',
          translate: '-50% 0',
        }"
        @mouseenter="isThumbHovering = true"
        @mouseleave="isThumbHovering = false"
      />
    </div>

    <div
      v-else
      ref="trackRef"
      class="s-slider-hitbox relative flex justify-center h-full touch-none"
      :style="{ width: `${thumbSize}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onPointerCancel"
    >
      <div
        class="s-slider-track absolute top-0 bottom-0 rounded-full"
        :class="cover ? 'bg-cover/25' : 'bg-on-surface/12'"
        :style="{ width: `${trackHeight}px` }"
      />
      <div
        v-if="centerFill"
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-0.5 rounded-full bg-on-surface/20"
        :style="{ width: `${trackHeight + 6}px` }"
      />
      <div
        class="s-slider-fill absolute rounded-full"
        :class="cover ? 'bg-cover/100' : 'bg-primary'"
        :style="
          centerFill
            ? {
                width: `${trackHeight}px`,
                bottom: centerFillStyle.start,
                height: centerFillStyle.length,
              }
            : {
                width: `${trackHeight}px`,
                bottom: '0',
                height: 'var(--s-slider-progress)',
              }
        "
      />
      <div
        class="s-slider-thumb absolute rounded-full shadow-sm transition-[transform,opacity] duration-150"
        :class="[
          thumbVisible ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          cover ? 'bg-cover/100' : 'bg-primary',
        ]"
        :style="{
          width: `${thumbSize}px`,
          height: `${thumbSize}px`,
          bottom:
            'clamp(calc(var(--s-slider-thumb-half) - 2px), var(--s-slider-progress), calc(100% - var(--s-slider-thumb-half) + 2px))',
          translate: '0 50%',
        }"
        @mouseenter="isThumbHovering = true"
        @mouseleave="isThumbHovering = false"
      />
    </div>

    <div v-if="marks && !vertical" class="relative w-full mt-1.5" :style="{ height: '18px' }">
      <span
        v-for="(label, key) in marks"
        :key="key"
        class="absolute text-xs text-on-surface-variant/50 leading-none select-none whitespace-nowrap cursor-pointer hover:text-on-surface-variant/80 transition-colors"
        :style="{
          left: `${toPercent(Number(key))}%`,
          translate:
            toPercent(Number(key)) <= 0
              ? '0 0'
              : toPercent(Number(key)) >= 100
                ? '-100% 0'
                : '-50% 0',
        }"
        @click="onMarkClick(Number(key))"
      >
        {{ label }}
      </span>
    </div>

    <!-- Popover -->
    <div
      v-if="showPopover && slots.popover && !vertical"
      class="s-slider-popover absolute pointer-events-none transition-opacity duration-200 ease-out z-20"
      :class="[
        popoverSide === 'top' ? 'bottom-full' : 'top-full',
        popoverVisible ? 'opacity-100' : 'opacity-0',
      ]"
      :style="{
        left: 'clamp(24px, var(--s-slider-progress), calc(100% - 24px))',
        translate: `calc(-50% + ${popoverShift}px) 0`,
        [popoverSide === 'top' ? 'marginBottom' : 'marginTop']: `${popoverOffset}px`,
      }"
    >
      <div
        ref="popoverContentRef"
        class="s-slider-popover-content rounded-lg px-2 py-1 text-xs font-medium shadow-lg whitespace-nowrap border border-solid bg-surface-bright text-on-surface border-outline-variant/30"
        :style="{
          maxWidth: 'min(360px, calc(100vw - 16px))',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }"
      >
        <slot name="popover" :value="displayValue" />
      </div>
    </div>

    <div
      v-if="showPopover && slots.popover && vertical"
      class="s-slider-popover absolute pointer-events-none transition-opacity duration-200 ease-out z-20"
      :class="[
        popoverSide === 'left' ? 'right-full' : 'left-full',
        popoverVisible ? 'opacity-100' : 'opacity-0',
      ]"
      :style="{
        bottom: 'clamp(12px, var(--s-slider-progress), calc(100% - 12px))',
        translate: '0 50%',
        [popoverSide === 'left' ? 'marginRight' : 'marginLeft']: `${popoverOffset}px`,
      }"
    >
      <div
        class="s-slider-popover-content rounded-lg px-2 py-1 text-xs font-medium shadow-lg whitespace-nowrap border border-solid bg-surface-bright text-on-surface border-outline-variant/30"
      >
        <slot name="popover" :value="displayValue" />
      </div>
    </div>
  </div>
</template>
