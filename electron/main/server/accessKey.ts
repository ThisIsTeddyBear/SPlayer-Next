import { randomBytes } from "node:crypto";
import { store } from "@main/store";

/** 首次使用时生成独立的外部控制令牌。 */
export const getAccessKey = (): string => {
  const current = store.get("externalApi.accessKey");
  if (typeof current === "string" && /^[a-f0-9]{64}$/.test(current)) return current;
  return rotateAccessKey();
};

export const rotateAccessKey = (): string => {
  const key = randomBytes(32).toString("hex");
  store.set("externalApi.accessKey", key);
  return key;
};
