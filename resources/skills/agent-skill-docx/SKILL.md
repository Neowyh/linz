---
name: Word 文档（docx）
description: 创建、读取、编辑、批注 Word 文档（.docx/.dotx），含目录、页码、修订追踪、批注、图片、查找替换、格式整理。用户提到 word 文档、docx、报告、公文、模板、批注、修订、查找替换时使用。不要用于 PDF、电子表格或与文档生成无关的任务。
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX 创建、编辑与分析（应用内置离线版）

一个 `.docx` 本质是 ZIP 包内的 XML 文件集合。按任务选择路线：

| 任务 | 做法 |
|---|---|
| **新建**文档 | 用 **node 工具**执行内联 JS（`docx` npm 库已内置，直接 `require('docx')`）——见下方 docx-js 要点 |
| **编辑**已有文档 | 用 **python 工具**内联代码 `zipfile` 解包 → 改 `word/document.xml` → 回包（docx-js 不能打开已有文件） |
| **读取**内容 | 用 **python 工具**内联代码调用 `pandoc -t markdown file.docx`（pandoc 已内置在 PATH，`subprocess` 可调），或 `python-docx`（已内置） |

> 技能包脚本用 **run_skill_script** 执行（skill 填「Word 文档（docx）」或 `agent-skill-docx`，script 填 `scripts/` 下相对路径）。输出文件写到工作区目录并在回复中给出完整路径。

## 用 docx-js 新建——要点

`docx` 库已随应用内置，**不要** `npm install`：直接用 node 工具写内联 JS 并 `require('docx')`。注意这些坑：

- **页面默认 A4。** 美国 Letter 需 `page: { size: { width: 12240, height: 15840 } }`（DXA 单位，1440 = 1 英寸）。
- **横向页面：** 传纵向尺寸加 `orientation: PageOrientation.LANDSCAPE`——docx-js 内部自行交换宽高。
- **表格需要双宽度：** 表格设 `columnWidths`，每个单元格也要设 `width`，都用 `WidthType.DXA`（PERCENTAGE 在 Google Docs 会坏）。列宽之和必须等于表格总宽。
- **单元格底纹：** 用 `ShadingType.CLEAR`，绝不用 `SOLID`（会渲染成黑色）。
- **列表：** 绝不要字面插入 `•`；用 `numbering` 配置 + `LevelFormat.BULLET`。
- **`ImageRun` 必须带 `type:`**（`"png"`、`"jpg"`…）。
- **`PageBreak` 必须放在 `Paragraph` 内部。**
- **绝不用 `\n`**——用独立的 `Paragraph` 元素。
- **目录：** 标题必须用内置 `HeadingLevel.*`；自定义标题样式要设 `outlineLevel` 否则不进目录。
- **不要用表格当水平分隔线**——用段落下边框。
- **点线引导符/同行右对齐：** 用 `PositionalTab`（`alignment: PositionalTabAlignment.RIGHT`、`leader: PositionalTabLeader.DOT`）放在 `TextRun` 里，不要用字面 `.` 或空格填充。

## 校验输出

写入 `.docx` 后做基本校验：

```bash
# 用 run_skill_script 执行包内 XSD 校验（lxml 已内置）：
#   skill: Word 文档（docx）, script: scripts/office/validate.py, args: <out.docx> [--original <原文件>]
```

渲染目视校验需要 LibreOffice，**未随应用内置**：本机装有 LibreOffice 时可用 `run_skill_script` 执行 `scripts/office/soffice.py --headless --convert-to pdf out.docx` + 内置 `pdftoppm -jpeg -r 100` 转图查看；没有 LibreOffice 时跳过渲染，改为 pandoc 转 markdown 检查内容、validate.py 检查结构，并在回复中说明渲染校验未做。

## 编辑已有文档

旧版 `.doc` 需先转换：本机装有 LibreOffice 时用 `scripts/office/soffice.py --headless --convert-to docx file.doc`，否则告知用户。

解包/回包用 python 工具内联代码（不要用 docx-js 打开已有文件）：

```python
import zipfile, os
with zipfile.ZipFile('doc.docx') as z: z.extractall('unpacked')
# 删除符号链接条目（外部来源 docx 不可信）
for root, dirs, files in os.walk('unpacked'):
    for f in files:
        p = os.path.join(root, f)
        if os.path.islink(p): os.remove(p)
# …编辑 unpacked/word/document.xml（不要格式化/美化打印）…
with zipfile.ZipFile('out.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join('unpacked', '[Content_Types].xml'), '[Content_Types].xml')  # 必须最先写入
    for root, _, files in os.walk('unpacked'):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, 'unpacked'))
```

改完跑 `scripts/office/validate.py out.docx --original doc.docx`（run_skill_script，`--auto-repair` 可修常见问题）；做修订时加 `--author "<修订人名字>"` 检查每次编辑都被追踪。

Word 会把文本拆到大量 `<w:r>` run 里（修订 id、拼写标记），所以你在文档里看到的连续文字在 XML 中往往不是连续字符串。`merge_runs.py` 会合并相邻同格式 run 而不改变内容与渲染；可直接传 `.docx`：`python scripts/merge_runs.py doc.docx -o merged.docx`（run_skill_script）。

**修订追踪：** 改 `<w:ins>`/`<w:del>` 包裹的 run 时带 `w:id`、`w:author`、`w:date` 属性；`<w:del>` 内文本元素是 `<w:delText>` 而非 `<w:t>`。删除段落标记（`<w:pPr><w:rPr><w:del …/></w:rPr></w:pPr>`）表示"本段并入下一段"——整段删除就是它加每个 run 的 `<w:del>`。`<w:del/>` 必须位于 rPr 其他子元素之前（顺序由 schema 强制）。

出一份接受全部修订的干净副本：`scripts/accept_changes.py in.docx out.docx`（run_skill_script；需要 LibreOffice，未装时改用 pandoc `--track-changes=accept` 或手动接受并说明）。

## 批注

批注需要六个相互关联的文件。用包内脚本（目录模式适合还要改 document.xml 时，省一轮解包/回包；`.docx` 直连模式其他情况）：

- `scripts/comment.py unpacked/ "批注内容"`（目录模式，还可 `--parent 0` 回复父批注）
- `scripts/comment.py contract.docx "内容" -o annotated.docx`（文件模式）

脚本会写 `comments.xml`、`commentsExtended.xml`、`commentsIds.xml`、`commentsExtensible.xml`、关系与内容类型覆盖项，批注 ID 自动分配，然后打印需要加进 `word/document.xml` 的 `<w:commentRangeStart>`/`<w:commentRangeEnd>`/`<w:commentReference>` 片段——不放置这些标记，批注存在但不可见。

## 依赖（均已内置或降级）

`docx`（npm，内置，node 工具直接 require）· `pandoc`（内置）· LibreOffice `soffice`（未内置，缺省降级）· `pdftoppm`（Poppler，内置）
