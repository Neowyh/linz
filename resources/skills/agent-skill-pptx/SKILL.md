---
name: PPT 幻灯片（pptx）
description: 创建、读取、编辑 .pptx/.potx 演示文稿，含模板处理、备注、图表、批量改版。用户提到 ppt、pptx、幻灯片、演示文稿、deck、模板时使用。不要用于 Word/Excel/PDF 等非演示文稿任务。
license: Proprietary. LICENSE.txt has complete terms
---

# PPTX 创建、编辑与分析（应用内置离线版）

## 运行环境说明

- 内联 JavaScript 用 **node 工具**执行（`pptxgenjs` 已内置，直接 `require('pptxgenjs')`，**不要** npm install）。
- 内联 Python 用 **python 工具**执行（已预装 `Pillow`、`defusedxml`、`lxml`、`python-pptx` 等）。
- 技能包脚本用 **run_skill_script** 执行（skill 填「PPT 幻灯片（pptx）」或 `agent-skill-pptx`，script 填 `scripts/` 下相对路径）。
- LibreOffice（soffice）**未内置**：渲染成图/PDF 的视觉 QA 与 `.ppt` 转换仅在本机装有 LibreOffice 时可用（`scripts/office/soffice.py` 自动探测），否则跳过渲染 QA 并告知用户。
- 输出文件写到工作区目录并在回复中给出完整路径。

一个 `.pptx` 本质是 ZIP 包内的 XML 文件集合。按任务选择路线：

| 任务 | 做法 |
|---|---|
| **新建**演示文稿 | 用 **node 工具**执行内联 JS（`pptxgenjs` 库已内置）——见下方要点 |
| **编辑**已有文稿，或基于模板 | 用 **python 工具**内联代码 `zipfile` 解包 → 改 `ppt/slides/slideN.xml` → 回包；结构操作用包内脚本 |
| **读取**内容 | 用 **python 工具**内联代码 `python-pptx` 读取（已内置）；视觉网格图用 `scripts/thumbnail.py` |

## 包内脚本

| 脚本 | 用途 |
|---|---|
| `scripts/thumbnail.py deck.pptx [prefix]` | 每页幻灯片的标注网格图（真实渲染，**需要 LibreOffice**）。`.pptx` 专用。`prefix` 必传（默认 `thumbnails` 会覆盖同目录其他文稿的网格图）。**无 LibreOffice 时不可用**——改用 python-pptx 内联代码提取每页文本与形状布局做结构分析 |
| `scripts/add_slide.py unpacked/ slide2.xml [--after slideN.xml]` | 复制幻灯片（或 slideLayoutN.xml）并完成全部包级登记。也支持 `add_slide.py deck.pptx slide2.xml -o out.pptx`（**必须传 `-o`**，否则原地重写输入文件） |
| `scripts/clean.py unpacked/` | 删除不再被引用的幻灯片、媒体与 rels。**在** `<p:sldIdLst>` 定稿**后**运行 |
| `scripts/office/validate.py deck.pptx [--original src.pptx]` | Schema、关系、内容类型、图表与幻灯片检查，每个失败都指明修法。模板衍生的文稿必须传 `--original` 做基线比对（**无需 LibreOffice，lxml 已内置**） |
| `scripts/office/soffice.py --headless --convert-to pdf deck.pptx` | LibreOffice 包装（未内置，本机装有 LibreOffice 才可用） |

## 用 pptxgenjs 新建——要点

`pptxgenjs` 已随应用内置：用 node 工具写内联 JS，`require('pptxgenjs')` 直接可用。注意这些坑：

- **先设 `pres.layout` 再加幻灯片。** 默认画布 `LAYOUT_16x9` = **10" × 5.625"**，不是 13.3" 宽。坐标超出边缘只写不夹——形状只是不在页上。（`LAYOUT_WIDE` 是 13.3" × 7.5"。）
- **十六进制颜色：绝不用 `#`，绝不用 8 位。** `color: "FF0000"`。`"#FF0000"` 和带 alpha 的 `"00000020"` **都会损坏文件**。半透明：填充/图片用 `transparency: 0-100`，阴影用 `opacity: 0.0-1.0`——放错位置会被静默忽略。
- **pptxgenjs 会原地修改选项对象**（首次使用转成 EMU）。绝不跨两个 `add*` 调用共享同一个 `shadow`/options 对象——每次新建。
- **阴影 `offset` 必须 ≥ 0**——负值损坏文件。要向上投影用 `angle: 270` + 正值 offset。
- **`letterSpacing` 被静默忽略**——真正生效的是 `charSpacing`。
- **列表：** 每项 `bullet: true`，绝不字面 `•`（会双弹头）。除最后一项外每项设 `breakLine: true`。段间距用 `paraSpaceAfter`，别用 `lineSpacing`（间距巨大）。
- **每个输出文件新建一个 `new pptxgen()`**——绝不复用实例。
- **`rectRadius` 只对 `ROUNDED_RECTANGLE` 生效**，`RECTANGLE` 无效。
- **不支持渐变填充**——背景用渐变图代替。
- **文本框有内建内边距**——文本要与同一 x 的图形/线条/图标对齐时设 `margin: 0`。
- **演讲者备注用 `slide.addNotes("...")`**（纯文本，每页一次），不要放幻灯片上的文本框里。
- **图表保持原生。** 一切 PowerPoint 能画的图都用 `addChart()`（组合图传 `{type, data, options}` 数组）。库不暴露的原生特性（趋势线、误差线）自己算附加序列或后处理生成的 OOXML——不要退化成图片。只有 PowerPoint 没有原生形态的图（桑基、网络、和弦）才用图片。
- **默认图表很裸**——无标题、无数据标签、配色陈旧。设 `showTitle` + `title`、`showValue: true` + `dataLabelPosition`、`chartColors: [...]`，并压掉框线（`catAxisLabelColor`/`valAxisLabelColor`、`valGridLine: { color, size }`、`catGridLine: { style: "none" }`、单序列 `showLegend: false`）。
- **堆叠柱/条形图的 `dataLabelPosition` 必须是 `ctr`、`inEnd` 或 `inBase`**——`outEnd` **损坏文件**。
- **组合图用 `secondaryValAxis`/`secondaryCatAxis` 时，chart options 里要同时给 `valAxes` 和 `catAxes`，各两项。** 缺了 pptxgenjs 会写它从未声明的坐标轴 id，PowerPoint **丢弃该图**并报文件损坏。只给 `valAxes` 不够。
- **`writeFile()` 后运行 `scripts/office/validate.py deck.pptx`**（run_skill_script）。它报上面两个图表故障和 PowerPoint 拒绝的幻灯片 XML 缺陷，并指明修法——在生成器里改，不要手改打包后的 XML。
- **绝不要重排 `<p:presentation>` 的子元素顺序。** pptxgenjs 在 `<p:sldIdLst>` 后紧跟 `<p:notesMasterIdLst>`，两个 master 指向同一个 theme part。移动元素后 PowerPoint 打不开。
- **图标：** `react-icons`/`sharp` 未内置。简单图标用 python 工具 + PIL 画 PNG（彩色圆形底 + 白色符号/文字）后 `addImage({ data: "image/png;base64,..." })`（`image/png;base64,` 前缀必须有）；复杂图标让用户提供素材，或从模板已有元素里复用。

## 编辑已有文稿与模板

先选版式：`scripts/thumbnail.py template.pptx template-thumbs`（run_skill_script）写出每页的标注网格图并打印生成的文件——**第二个参数必传且以文稿命名**，默认 `thumbnails` 会互相覆盖。`.potx` 先复制成 `.pptx` 名字再转图。用 python-pptx 读文本，把每块内容映射到模板的幻灯片上，**不要所有章节都放同一个标题+要点版式**。

解包/回包用 python 工具内联代码：

```python
import zipfile, os
with zipfile.ZipFile('deck.pptx') as z: z.extractall('unpacked')
# …结构操作（add_slide.py / clean.py）与内容编辑（ppt/slides/slideN.xml）…
with zipfile.ZipFile('out.pptx', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join('unpacked', '[Content_Types].xml'), '[Content_Types].xml')  # 必须先写入
    for root, _, files in os.walk('unpacked'):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, 'unpacked'))
```

流程：`scripts/add_slide.py unpacked/ slide2.xml --after slide2.xml` 复制幻灯片（打印新幻灯片路径）→ 在 `ppt/presentation.xml` 的 `<p:sldIdLst>` 里排序/删页 → `scripts/clean.py unpacked/` 清理孤儿 → 编辑 `ppt/slides/slideN.xml` → 回包 → `scripts/office/validate.py out.pptx --original deck.pptx`。

- **所有结构工作（增、删、排序）在编辑任何一页内容之前做完。** `add_slide.py` 原样复制幻灯片文件，编辑后再复制会克隆已改内容；`clean.py` 会删掉不在 `<p:sldIdLst>` 里的任何页，包括你刚写的。
- **绝不手工复制幻灯片文件**——`add_slide.py` 会做新页需要的全部登记。复制出的页仍**引用**源页的图表/SmartArt/嵌入对象部件而不是克隆它们，改一页的图另一页也变。
- **如果用 python-pptx**：它做不了三件事——复制页（只有 `add_slide(layout)`）、`text_frame.text = "..."` 保留格式（会把段落压成单个无样式 run，改用 `run.text` 赋值）、读模板常见的 SVG/EMF 图（`add_picture` 会抛 `UnidentifiedImageError`）。
- 旧版 `.ppt` 需先转换：本机装有 LibreOffice 时用 `scripts/office/soffice.py --headless --convert-to pptx file.ppt`，否则告知用户。`.potx` 模板解包回包方式相同，输出保留 `.potx` 扩展名。
- 复用模板图标/图片：复制包含它的页或版式。

填充模板时：

- 脚本化 XML 变换用 `defusedxml.minidom` 解析——OOXML 过 `xml.etree.ElementTree` 会重写命名空间前缀并损坏文稿。
- **模板槽位 ≠ 源内容项。** 模板显示 4 个成员你只有 3 个，就删掉第 4 个的整组（图片+文本框），不是只删文字——然后 QA 检查孤儿图形。
- 每个列表项一个 `<a:p>`——绝不把多项拼进一个段落。复制同级 `<a:pPr>` 保持间距；标题、节标题、行内标签（`Status:`、`Owner:`）在 `<a:rPr>` 上放 `b="1"`。
- 项目符号继承自版式；只有覆盖时才加 `<a:buChar>`、`<a:buAutoNum>`（编号）或 `<a:buNone>`——绝不字面 `•`。
- 首尾带空格的文本要加 `xml:space="preserve"` 到 `<a:t>`。

## 设计规范

**不要做无聊的幻灯片。** 白底纯要点打动不了人。每页从中选点子：

### 开始前
- **选一个贴合主题的醒目配色**：一种主色占 60-70% 视觉重量，1-2 个支撑色，一个锐利点缀色。绝不五五开。
- **明暗对比**：标题页/结论页深色背景，内容页浅色（"三明治"结构）；或整场深色。
- **定一个视觉母题**：选一个有辨识度的元素反复出现——圆角图片框、彩色圆内图标。**不要用色条/强调条纹当母题**（见避坑）。

### 配色参考
| 主题 | 主色 | 辅助 | 点缀 |
|---|---|---|---|
| Midnight Executive | `1E2761` 藏青 | `CADCFC` 冰蓝 | `FFFFFF` 白 |
| Forest & Moss | `2C5F2D` 森林 | `97BC62` 苔绿 | `F5F5F5` 米白 |
| Coral Energy | `F96167` 珊瑚 | `F9E795` 金 | `2F3C7E` 藏青 |
| Warm Terracotta | `B85042` 赤陶 | `E7E8D1` 沙 | `A7BEAE` 鼠尾草 |
| Ocean Gradient | `065A82` 深蓝 | `1C7293` 青绿 | `21295C` 午夜 |
| Charcoal Minimal | `36454F` 炭灰 | `F2F2F2` 灰白 | `212121` 黑 |
| Teal Trust | `028090` 青碧 | `00A896` 海泡 | `02C39A` 薄荷 |
| Berry & Cream | `6D2E46` 莓红 | `A26769` 灰粉 | `ECE2D0` 奶油 |
| Sage Calm | `84B59F` 鼠尾草 | `69A297` 桉树 | `50808E` 板岩 |
| Cherry Bold | `990011` 樱桃 | `FCF6F5` 白 | `2F3C7E` 藏青 |

### 每页
**每页都要有视觉元素**——图、表、图标或形状。纯文字页留不住人。版式选项：双栏（左文右图）、图标+文字行（彩色圆底图标、粗体标题、下方说明）、2x2/2x3 网格（图一侧，内容块网格另一侧）、半出血图（左/右半页图片 + 内容叠加）。

**数据展示：** 大数字标注（60-72pt 大数字 + 小标签）、对比列（前后、利弊、并排）、时间线/流程（编号步骤、箭头）。

**视觉打磨：** 节标题旁彩色小圆图标、关键数据/标语用斜体点缀文字。

### 字体与字号
写进 .pptx 的字体由用户的 PowerPoint 渲染。安全字体（各环境宽度一致）：**Arial、Calibri、Cambria、Times New Roman、Courier New、Bookman Old Style、Century Schoolbook**——正文与任何需要贴边的文字用它。标题可以用衬线体（Cambria、Bookman、Century Schoolbook）配无衬线正文（Calibri/Arial）制造对比。用户指定了安全列表外的字体就用，但容器多留 ~10% 余量。**绝不用 Aptos 作默认**（老 Office 没有）。QA 渲染需 LibreOffice（未内置），所以字体贴边只能靠保守估算。

| 元素 | 字号 |
|---|---|
| 幻灯片标题 | 36-44pt 粗体 |
| 节标题 | 20-24pt 粗体 |
| 正文 | 14-16pt |
| 说明文字 | 10-12pt 弱化 |

### 间距
0.5" 最小页边距；内容块间 0.3-0.5"；留白，别填满每寸。

### 避坑
- 不要重复同一版式——列、卡片、标注轮换
- 正文不要居中——段落和列表左对齐；只有标题居中
- 字号对比要足——标题 36pt+，与 14-16pt 正文拉开
- 不要默认蓝色——选贴合主题的配色
- 不要混排间距——统一 0.3" 或 0.5"
- 不要只做一页特殊样式其余全素——要么整场做足，要么全场从简
- 不要做纯文字页——加图、图标、图表或形状
- 不要忽略文本框内边距——对齐线条/形状时设 `margin: 0` 或偏移补偿
- 不要用低对比元素——浅底浅字、深底深字都不行
- **标题下绝不放强调线**——AI 生成味浓重；用留白或背景色
- **绝不放装饰色条/强调条纹**——顶栏、侧边竖条、卡片边缘细条都算；用浅色底、投影或图标区分卡片
- 不要默认米色/奶油底——不指定时用白 `FFFFFF` 或品牌色
- 不要交付溢出文本——放不下就减小字号、拆页或放大容器

## QA（必需）

首次渲染通常有真问题——重叠、溢出、错位。找到修掉，只重渲改动页。

### 内容 QA
用 python 工具内联代码读取文本核对内容：
```python
from pptx import Presentation
prs = Presentation("output.pptx")
for i, slide in enumerate(prs.slides, 1):
    print(f"--- Slide {i} ---")
    for shape in slide.shapes:
        if shape.has_text_frame:
            print(shape.text)
```
检查缺失内容、错字、顺序错误。模板场景检查残留占位文本（XXX、lorem、TODO、[insert...]）。

### 文件 QA（必需）
```bash
# run_skill_script:
#   script: scripts/office/validate.py, args: output.pptx          （从零新建）
#   script: scripts/office/validate.py, args: output.pptx --original src.pptx  （模板衍生）
```
**模板衍生的文稿必须传 `--original`。** 模板自身可能含 XSD 拒绝的部件，裸跑会报你没造成的失败——`--original` 以模板为基线，压制它已有的错误。结构检查（关系、内容类型、图表）无视 `--original`，模板继承的问题照报。

pptxgenjs 会写出 PowerPoint 拒绝、其他工具全接受的图表 XML：python-pptx 打得开、LibreOffice 渲染得出、XSD 过得了。每个失败都指明修法——在生成器里修好重建。

### 视觉 QA（视 LibreOffice 而定）
本机装有 LibreOffice 时：`scripts/office/soffice.py --headless --convert-to pdf output.pptx` → 内置 `pdftoppm -jpeg -r 150 output.pdf slide` → 看每页图片。重点查：**文本溢出/截断（最常犯）**、元素重叠、引用/页脚碰撞、间距不均、页边距不足、列不对齐、低对比文本、模板装饰错位、图标低对比、文本框过窄、残留占位。没有 LibreOffice 则跳过并告知用户渲染 QA 未做。

## 依赖（均已内置或降级）

`pptxgenjs`（npm，内置，node 工具直接 require）· `Pillow`、`defusedxml`、`lxml`、`python-pptx`（pip，已预装）· LibreOffice `soffice`（未内置，缺省降级）· `pdftoppm`（Poppler，内置）
