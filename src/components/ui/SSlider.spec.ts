import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SSlider from "./SSlider.vue";

describe("slider keyboard access", () => {
  it("does not commit a seek when the pointer gesture is cancelled", async () => {
    const wrapper = mount(SSlider, { props: { modelValue: 50 } });
    const hitbox = wrapper.find(".s-slider-hitbox");
    const element = hitbox.element as HTMLElement;
    element.setPointerCapture = () => undefined;
    element.getBoundingClientRect = () => new DOMRect(0, 0, 100, 14);
    await hitbox.trigger("pointerdown", { pointerId: 1, button: 0, clientX: 80, clientY: 0 });
    await hitbox.trigger("pointercancel", { pointerId: 1 });
    expect(wrapper.emitted("dragEnd")).toBeUndefined();
    expect(wrapper.emitted("dragCancel")?.[0]).toEqual([50]);
    wrapper.unmount();
  });

  it("exposes semantics and commits keyboard changes to seek consumers", async () => {
    const wrapper = mount(SSlider, { props: { modelValue: 50, min: 0, max: 100, step: 5 } });
    expect(wrapper.attributes("role")).toBe("slider");
    expect(wrapper.attributes("tabindex")).toBe("0");
    expect(wrapper.attributes("aria-valuenow")).toBe("50");
    await wrapper.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([55]);
    expect(wrapper.emitted("dragEnd")?.[0]).toEqual([55]);
    await wrapper.trigger("keydown", { key: "Home" });
    await wrapper.trigger("keydown", { key: "End" });
    expect(wrapper.emitted("dragEnd")?.slice(1)).toEqual([[0], [100]]);
    wrapper.unmount();
  });

  it("supports fractional volume and ignores disabled keyboard input", async () => {
    const wrapper = mount(SSlider, { props: { modelValue: 0.3, max: 1, step: 0.01, vertical: true } });
    await wrapper.trigger("keydown", { key: "ArrowUp" });
    expect(wrapper.emitted("change")?.[0]).toEqual([0.31]);
    await wrapper.setProps({ disabled: true });
    await wrapper.trigger("keydown", { key: "ArrowUp" });
    expect(wrapper.emitted("change")).toHaveLength(1);
    expect(wrapper.attributes("aria-orientation")).toBe("vertical");
    expect(wrapper.attributes("tabindex")).toBe("-1");
    wrapper.unmount();
  });
});
