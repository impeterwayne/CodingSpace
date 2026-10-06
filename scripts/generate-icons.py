import os
import subprocess
from PIL import Image, ImageDraw

def generate_icons():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = os.path.join(root_dir, 'build')
    icon_png_path = os.path.join(build_dir, 'icon.png')
    icon_ico_path = os.path.join(build_dir, 'icon.ico')

    # Read base 1024x1024 image from git HEAD if available to ensure clean source
    try:
        raw_data = subprocess.check_output(['git', 'show', 'HEAD:build/icon.png'], cwd=root_dir)
        import io
        src = Image.open(io.BytesIO(raw_data)).convert('RGBA')
    except Exception:
        src = Image.open(icon_png_path).convert('RGBA')

    w, h = src.size
    radius = 224  # macOS / iOS standard corner radius for 1024x1024 (21.875%)

    # 8x supersampling for perfectly smooth antialiasing
    scale = 8
    sw, sh = w * scale, h * scale
    mask = Image.new('L', (sw, sh), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, sw - 1, sh - 1], radius=radius * scale, fill=255)
    mask = mask.resize((w, h), Image.Resampling.LANCZOS)

    rounded_png = src.copy()
    rounded_png.putalpha(mask)
    rounded_png.save(icon_png_path, format='PNG')
    print(f'Successfully updated {icon_png_path}')

    # Multi-resolution Windows ICO with full 32-bit RGBA transparency
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    rounded_png.save(icon_ico_path, format='ICO', sizes=ico_sizes)
    print(f'Successfully updated {icon_ico_path}')

if __name__ == '__main__':
    generate_icons()
