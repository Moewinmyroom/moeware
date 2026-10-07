from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# Match the code-native Coach monogram, with generous maskable-icon safe space.
image = Image.new('RGB', (1024, 1024), '#f7f5fb')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((110, 110, 914, 914), radius=240, fill='#e9dff4')
font = ImageFont.truetype('C:/Windows/Fonts/georgiai.ttf', 700)
draw.text((505, 455), 'c', font=font, fill='#654887', anchor='mm')
draw.polygon([(727, 240), (750, 297), (807, 320), (750, 343), (727, 400), (704, 343), (647, 320), (704, 297)], fill='#765299')
for size in (180, 192, 512):
    image.resize((size, size), Image.Resampling.LANCZOS).save(Path('icons') / f'icon-{size}.png')
