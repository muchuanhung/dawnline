import { test, expect } from "@playwright/test";
import { readCookie } from "@/lib/auth/session-cookie";

const NAME = "firebase-id-token";

test.describe("readCookie", () => {
  test("reads the named cookie among others", () => {
    expect(readCookie(`theme=dark; ${NAME}=abc.def; rc_session=x`, NAME)).toBe("abc.def");
    expect(readCookie(`${NAME}=abc`, NAME)).toBe("abc");
  });

  test("decodes percent-encoding", () => {
    expect(readCookie(`${NAME}=a%2Bb`, NAME)).toBe("a+b");
  });

  test("ignores cookies whose name only ends with the target name", () => {
    expect(readCookie(`x${NAME}=evil`, NAME)).toBeNull();
    expect(readCookie(`x${NAME}=evil; ${NAME}=good`, NAME)).toBe("good");
  });

  test("malformed percent-encoding counts as signed out instead of throwing", () => {
    expect(readCookie(`${NAME}=%E0%A4%A`, NAME)).toBeNull();
  });

  test("missing or empty cookie is null", () => {
    expect(readCookie("", NAME)).toBeNull();
    expect(readCookie("theme=dark", NAME)).toBeNull();
    expect(readCookie(`${NAME}=`, NAME)).toBeNull();
  });
});
