import { timingSafeEqual } from "node:crypto";

/** 校验固定长度令牌，不接受 URL 查询参数中的凭据。 */
export const isAuthorized = (
  expected: string,
  authorization?: string,
  protocols?: string,
): boolean => {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const token =
    authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1] ??
    protocols
      ?.split(",")
      .map((value) => value.trim())
      .find((value) => /^splayer-token\.[a-f0-9]{64}$/.test(value))
      ?.slice(14);
  return (
    typeof token === "string" &&
    token.length === expected.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  );
};
