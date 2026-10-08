from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# Match the code-native Coach monogram, with generous maskable-icon safe space.
image = Image.new('RGB', (1024, 1024), '#f3f1e9')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((110, 110, 914, 914), radius=240, fill='#e9c66e')
font = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 700)
draw.text((505, 455), 'c', font=font, fill='#292d29', anchor='mm')
draw.ellipse((708, 244, 794, 330), fill='#292d29')
for size in (180, 192, 512):
    image.resize((size, size), Image.Resampling.LANCZOS).save(Path('icons') / f'icon-{size}.png')
