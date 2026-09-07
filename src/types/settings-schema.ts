import type { Component } from "vue";

export type SettingWidgetType =
  "switch" | "select" | "slider" | "color" | "button" | "custom" | "text" | "number";

export interface SettingOption {
  value: string | number | boolean;
  labelKey?: string;
  label?: string;
}

export interface SettingConfirm {
  when?: (nextValue: unknown) => boolean;
  titleKey?: string;
  contentKey: string;
  type?: "default" | "info" | "warning" | "error";
  confirmTextKey?: string;
  cancelTextKey?: string;
}

export interface SettingItem {
  key: string;
  type: SettingWidgetType;
  binding?: { store: "settings" | "theme"; path: string };
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  marks?: Record<number, string>;
  unit?: string;
  placeholderKey?: string;
  showAlpha?: boolean;
  colorFormat?: "rgb" | "hex";
  defaultValue?: unknown;
  descriptionKey?: string;
  hideDescription?: boolean;
  disabled?: () => boolean;
  visible?: () => boolean;
  confirm?: SettingConfirm;
  action?: (value?: unknown) => void | Promise<void>;
  component?: Component;
  componentProps?: Record<string, unknown>;
  fullWidth?: boolean;
  keywords?: string[];
  searchable?: boolean;
  children?: SettingItem[];
  childrenCondition?: () => boolean;
  hideChildren?: boolean;
  tag?: SettingTag;
}

export interface SettingTag {
  text: string;
  type?: "default" | "primary" | "cover" | "info" | "success" | "warning" | "error";
}

export interface SettingSection {
  id: string;
  items: SettingItem[];
  tag?: SettingTag;
  visible?: () => boolean;
}

export interface SettingCategory {
  id: string;
  icon: Component;
  sections?: SettingSection[];
  component?: Component;
}
