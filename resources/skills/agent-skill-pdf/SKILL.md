---
name: PDF 文档
description: PDF 文件的读写、合并拆分、旋转、水印、加密解密、提取表格/图片、新建 PDF、填写表单、扫描件 OCR。用户提到 .pdf、PDF、合并 pdf、填表、pdf 转图时使用。
license: Proprietary. LICENSE.txt has complete terms
---

# PDF 处理指南（应用内置离线版）

## 运行环境说明

- 所有 Python 代码用 **python 工具**执行（内置 Python 3.8.10，已预装 `pypdf`、`pdfplumber`、`reportlab`、`pandas`、`Pillow`、`pdf2image` 等，**不要**先 pip install）。
- Poppler 已随应用内置（`pdftoppm`/`pdftotext`/`pdfinfo`/`pdfimages`，已在 PATH 上）——python 工具的内联代码里可直接 `subprocess.run(["pdftotext", ...])`。
- 技能包脚本用 **run_skill_script** 执行（skill 填「PDF 文档」或 `agent-skill-pdf`，script 填 `scripts/` 下相对路径）。
- **未内置**：qpdf、pdftk（用 pypdf 等价实现）、Tesseract/OCR（需本机安装 Tesseract，未装则跳过 OCR 并告知用户）、pypdfium2。
- 输出文件写到工作区目录并在回复中给出完整路径。

## 快速上手

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python 库

### pypdf——基本操作

合并：
```python
from pypdf import PdfWriter, PdfReader
writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)
with open("merged.pdf", "wb") as output:
    writer.write(output)
```

拆分（每页一个文件）：
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

元数据 / 旋转 / 裁剪：
```python
reader = PdfReader("document.pdf")
meta = reader.metadata
page = reader.pages[0]
page.rotate(90)  # 顺时针 90 度
page.mediabox.left, page.mediabox.bottom = 50, 50   # 裁剪
page.mediabox.right, page.mediabox.top = 550, 750
```

### pdfplumber——文本与表格提取

```python
import pdfplumber
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"Table {j+1} on page {i+1}:", table)
```

复杂版式用自定义参数（`vertical_strategy: "lines"`、`snap_tolerance`、`intersection_tolerance` 等）；`page.to_image(resolution=150).save("debug.png")` 可做表格提取的视觉调试。带坐标提取：`page.chars`（每个字符有 `text`/`x0`/`y0`）、`page.within_bbox((l,t,r,b)).extract_text()`。

### reportlab——新建 PDF

```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
c = canvas.Canvas("hello.pdf", pagesize=letter)
w, h = letter
c.drawString(100, h - 100, "Hello World!")
c.line(100, h - 140, 400, h - 140)
c.save()
```

多页 + 表格（Platypus）：
```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = [Paragraph("Report Title", styles['Title']), Spacer(1, 12)]
story.append(Paragraph("This is the body. " * 20, styles['Normal']))
story.append(PageBreak())
data = [['Product', 'Q1', 'Q2'], ['Widgets', '120', '135'], ['Gadgets', '85', '92']]
table = Table(data)
table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
    ('GRID', (0, 0), (-1, -1), 1, colors.black)
]))
story.append(table)
doc.build(story)
```

**重要：不要在 reportlab 里用 Unicode 上下标字符**（₀₁₂₃₄₅₆₇₈₉、⁰¹²³⁴⁵⁶⁷⁸⁹）——内置字体没有这些字形，会渲染成黑块。用 Paragraph 的 XML 标记：`H<sub>2</sub>O`（下标）、`x<super>2</super>`（上标）。canvas 直接画字时手动调整字号与位置。

**中文 PDF：** 内置字体（Helvetica 等）不含中文字形，直接 drawString 中文会变乱码/方块。中文内容先注册 CID 字体再用：
```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
c.setFont('STSong-Light', 12)
```

## 命令行工具（内置 Poppler，python 里 subprocess 调用）

- `pdftotext input.pdf output.txt`——提取文本；`-layout` 保留版式；`-f 1 -l 5` 指定页范围。
- `pdftotext -bbox-layout input.pdf output.xml`——带坐标的文本（结构化数据用）。
- `pdftoppm -png -r 300 input.pdf prefix`——转图片；`-jpeg -jpegopt quality=85` 转 JPEG；`-f 1 -l 3` 页范围。
- `pdfimages -j -p input.pdf prefix`——提取内嵌图片；`-list` 列信息；`-all` 原格式导出。

示例：
```python
import subprocess
subprocess.run(["pdftotext", "-layout", "input.pdf", "output.txt"], check=True)
```

## 常见任务

### 水印
```python
from pypdf import PdfReader, PdfWriter
watermark = PdfReader("watermark.pdf").pages[0]
reader = PdfReader("document.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)
with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### 加密 / 解密
```python
from pypdf import PdfReader, PdfWriter
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
writer.encrypt("userpassword", "ownerpassword")
with open("encrypted.pdf", "wb") as output:
    writer.write(output)

# 解密（读受密码保护的 PDF）
reader = PdfReader("encrypted.pdf")
if reader.is_encrypted:
    reader.decrypt("password")
```

### 扫描件 OCR（可选）
`pytesseract` 需要本机安装 Tesseract（**未随应用内置**）。已安装时：
```python
from pdf2image import convert_from_path
import pytesseract
images = convert_from_path('scanned.pdf')
for i, image in enumerate(images):
    print(f"Page {i+1}:", pytesseract.image_to_string(image))
```
未安装 Tesseract 时跳过 OCR 并告知用户，用 pdftotext 先试文本层。

### 批处理与错误处理
```python
import glob
from pypdf import PdfReader, PdfWriter
for f in glob.glob("*.pdf"):
    try:
        reader = PdfReader(f)
        print(f, len(reader.pages), "pages")
    except Exception as e:
        print(f"failed {f}: {e}")
```

## 疑难排查

- 加密 PDF：`reader.is_encrypted` 检查后 `reader.decrypt(password)`。
- 大 PDF 不要整本 `extract_text()`：用 `pdftotext`（最快）或按页分块处理。
- 提取图片优先 `pdfimages`（比渲染页面快得多）。

---

# PDF 表单填写（必须按顺序完成，不要跳步直接写代码）

先检查 PDF 是否有可填表单字段。用 run_skill_script 执行（skill: PDF 文档）：
`script: scripts/check_fillable_fields.py`，`args: <file.pdf>`。
根据结果走下面「有可填字段」或「无可填字段」分支。

## 有可填字段

1. `scripts/extract_form_field_info.py <input.pdf> <field_info.json>` 生成字段清单 JSON：
   ```
   [ { "field_id": ..., "page": 页号(1起), "rect": [左,下,右,上] PDF坐标(y=0在底部), "type": "text|checkbox|radio_group|choice" },
     // checkbox 带 "checked_value"/"unchecked_value"
     // radio_group 带 "radio_options": [{"value":..., "rect":...}]
     // choice 带 "choice_options": [{"value":..., "text":...}] ]
   ```
2. 转 PNG 分析每个字段用途：`scripts/convert_pdf_to_images.py <file.pdf> <输出目录>`（用 pdf2image + 内置 poppler）。把 PDF 坐标换算成图片坐标再看图。
3. 建 `field_values.json`：
   ```
   [ { "field_id": "last_name", "description": "姓氏", "page": 1, "value": "Simpson" },
     { "field_id": "Checkbox12", "description": "成年勾选", "page": 1, "value": "/On" } ]
   ```
   checkbox 用其 `checked_value`；radio 用 `radio_options` 里的 `value`。
4. `scripts/fill_fillable_fields.py <input.pdf> <field_values.json> <output.pdf>` 生成填写后的 PDF。脚本会校验字段 ID 与值，打印错误就修正重试。

## 无可填字段（手写批注式填写）

先做结构提取（更准），不行再视觉估算。

### 第 1 步：结构提取
`scripts/extract_form_structure.py <input.pdf> form_structure.json`
输出 labels（文本+坐标 x0/top/x1/bottom）、lines（行边界线）、checkboxes（小方框+中心坐标）、row_boundaries。
结果里有有效 labels → 用「方案 A：结构坐标」；扫描件几乎无 labels → 用「方案 B：视觉估算」。

### 方案 A：结构坐标（优先）
- 分析 form_structure.json：相邻文本组成标签；top 相近的在同一行；填写区从标签结束处开始（x0 = 标签.x1 + 5）；checkbox 直接用其矩形。
- 坐标系：PDF 坐标，y=0 在**页面顶部**、向下增大。
- 建 fields.json（用 `pdf_width`/`pdf_height` 标记 PDF 坐标）：
  ```
  { "pages": [{"page_number": 1, "pdf_width": 612, "pdf_height": 792}],
    "form_fields": [
      { "page_number": 1, "description": "姓氏输入区", "field_label": "Last Name",
        "label_bounding_box": [43, 63, 87, 73], "entry_bounding_box": [92, 63, 260, 79],
        "entry_text": {"text": "Smith", "font_size": 10} },
      { "page_number": 1, "description": "Yes 勾选框", "field_label": "Yes",
        "label_bounding_box": [260, 200, 280, 210], "entry_bounding_box": [285, 197, 292, 205],
        "entry_text": {"text": "X"} } ] }
  ```

### 方案 B：视觉估算（扫描件兜底）
1. `scripts/convert_pdf_to_images.py <input.pdf> <images_dir/>` 转图。
2. 看每页图片，粗估字段位置（标签、输入区、勾选框的近似像素坐标）。
3. 精化：用 python 工具 PIL 裁剪放大关键区域再细看（ImageMagick 未内置，用 PIL 替代）：
   ```python
   from PIL import Image
   img = Image.open("images_dir/page_1.png")
   crop = img.crop((50, 120, 350, 200))   # 字段区域加 ~50px 留白
   crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
   crop.save("crops/name_field.png")
   ```
   把裁剪坐标换算回整图坐标：full_x = crop_x + offset_x，full_y = crop_y + offset_y。逐字段重复，相近字段合并裁剪。
4. 建 fields.json（用 `image_width`/`image_height` 标记图片坐标）：结构与方案 A 相同，但坐标是像素值。

### 混合方案
结构能出的字段用方案 A，结构漏掉的（圆形勾选框、复杂控件）用方案 B 精化；两种来源要统一到**同一坐标系**（图像坐标转 PDF 坐标：`pdf_x = image_x * pdf_width / image_width`）。

### 填写前校验
`scripts/check_bounding_boxes.py fields.json`——检查相交框、字号放不下的框，报错先修。

### 填写与验证
- `scripts/fill_pdf_form_with_annotations.py <input.pdf> fields.json <output.pdf>`（自动识别坐标系）。
- 验证：`scripts/convert_pdf_to_images.py <output.pdf> <verify_images/>` 转图核对文字位置；错位就检查坐标系选择与换算。

## 依赖（均已内置或降级）

`pypdf`、`pdfplumber`、`reportlab`、`pandas`、`Pillow`、`pdf2image`（pip，已预装）· `pdftoppm`/`pdftotext`/`pdfinfo`/`pdfimages`（Poppler，已内置）· Tesseract/OCR（未内置，本机装有才可用）· qpdf/pdftk（未内置，用 pypdf 等价实现）
