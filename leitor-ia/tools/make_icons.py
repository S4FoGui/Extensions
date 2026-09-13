"""Gera os ícones da extensão (PNG puro, sem dependências)."""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
BG = (0x14, 0x14, 0x14)      # preto
FG = (0xFA, 0xFA, 0xFA)      # branco


def burst(u, v):
    """Máscara do starburst central (0 = fundo, 1 = estrela)."""
    r = math.hypot(u, v)
    if r <= 0.24:
        return 1.0
    if r >= 0.90:
        return 0.0
    ang = math.atan2(v, u) % math.tau
    step = math.tau / 12
    a = ang % step
    d = min(a, step - a)
    w = 0.055 + 0.115 * ((r - 0.24) / (0.90 - 0.24))
    if d < w:
        t = (r - 0.78) / (0.90 - 0.78)
        return max(0.0, 1.0 - max(0.0, t))
    return 0.0


def inside_rounded_square(u, v):
    """Quadrado arredondado em coordenadas [-1, 1]."""
    cr = 0.45
    qx = abs(u) - (1 - cr)
    qy = abs(v) - (1 - cr)
    d = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - cr
    return d < 0


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size):
    ss = 3  # supersampling
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            ar = ag = ab = aa = 0
            for sy in range(ss):
                for sx in range(ss):
                    px = (x + (sx + 0.5) / ss) / size
                    py = (y + (sy + 0.5) / ss) / size
                    u, v = px * 2 - 1, py * 2 - 1
                    if not inside_rounded_square(u, v):
                        continue
                    c = burst(u, v)
                    r, g, b = mix(BG, FG, c)
                    ar += r
                    ag += g
                    ab += b
                    aa += 255
            n = ss * ss
            if aa == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((ar // n, ag // n, ab // n, aa // n))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT, f"icon{size}.png")
        write_png(path, size, make_icon(size))
        print("gerado:", path)


if __name__ == "__main__":
    main()
