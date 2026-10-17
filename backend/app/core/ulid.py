"""ULID 產生器（26 字 Crockford base32：48 bit 毫秒時間 + 80 bit 亂數），routes.public_id 用。"""

import re
import secrets
import time

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_PATTERN = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def new_ulid() -> str:
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    chars = []
    for _ in range(26):
        value, rem = divmod(value, 32)
        chars.append(_ALPHABET[rem])
    return "".join(reversed(chars))


def is_ulid(value: str) -> bool:
    return bool(ULID_PATTERN.match(value))
