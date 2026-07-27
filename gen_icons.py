# 生成 V055 PWA 图标（深色圆角底 + 品牌色柱状图，无字体依赖）
# 依赖：PIL（ak313_env 已含 pillow）
import math
from PIL import Image, ImageDraw

BG = (15, 20, 25)          # #0f1419
BAR_BLUE = (79, 157, 255)   # #4f9dff
BAR_GREEN = (52, 211, 153)  # #34d399
BAR_ORANGE = (255, 146, 43) # #ff922b
PANEL = (31, 39, 51)        # #1f2733

def round_rect(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)

def draw_chart(img, draw, area, maskable=False):
    """在 area=(x0,y0,x1,y1) 内画柱状图。maskable 时四周留安全边距。"""
    x0, y0, x1, y1 = area
    w = x1 - x0
    h = y1 - y0
    # 底板（浅色卡片）
    pad = int(w * 0.10)
    card = (x0 + pad, y0 + int(h * 0.14), x1 - pad, y1 - int(h * 0.14))
    round_rect(draw, card, int(w * 0.06), PANEL)
    cx0, cy0, cx1, cy1 = card
    cw = cx1 - cx0
    ch = cy1 - cy0
    # 三根柱子，高度递增再降，模拟走势
    heights = [0.45, 0.72, 0.58]
    colors = [BAR_BLUE, BAR_GREEN, BAR_ORANGE]
    n = len(heights)
    gap = cw * 0.18
    bw = (cw - gap * (n - 1)) / n
    base_y = cy1 - ch * 0.10
    top_y0 = cy0 + ch * 0.10
    for i in range(n):
        bx = cx0 + i * (bw + gap)
        bh = heights[i] * (base_y - top_y0)
        by = base_y - bh
        round_rect(draw, (bx, by, bx + bw, base_y), int(bw * 0.28), colors[i])

def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if maskable:
        # 全幅不透明背景，内容收在中心 80% 安全区
        draw.rectangle([0, 0, size, size], fill=BG)
        m = int(size * 0.10)
        area = (m, m, size - m, size - m)
    else:
        # 圆角方形图标
        draw.rectangle([0, 0, size, size], fill=(0, 0, 0, 0))
        r = int(size * 0.22)
        round_rect(draw, [0, 0, size, size], r, BG)
        area = (int(size * 0.06), int(size * 0.06), size - int(size * 0.06), size - int(size * 0.06))
    draw_chart(img, draw, area, maskable)
    return img

if __name__ == "__main__":
    make_icon(512).save("icon-512.png")
    make_icon(192).save("icon-192.png")
    make_icon(512, maskable=True).save("icon-maskable-512.png")
    print("icons generated: icon-192.png, icon-512.png, icon-maskable-512.png")
