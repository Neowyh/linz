---
name: Excel 表格（xlsx）
description: 创建、读取、编辑、修复 .xlsx/.xlsm/.xltx/.csv/.tsv 电子表格，含公式、格式、图表、数据清洗、金融模型、格式转换。用户提到 excel、xlsx、表格、电子表格、csv、公式、数据清洗时使用。交付物必须是表格文件。
license: Proprietary. LICENSE.txt has complete terms
---

# XLSX 创建、编辑与分析（应用内置离线版）

## 运行环境说明

- 所有 Python 代码用 **python 工具**执行（内置 Python 3.8.10，已预装 `openpyxl`、`pandas`、`numpy`、`lxml`、`defusedxml` 等，**不要**先 pip install，import 直接用）。
- 技能包脚本用 **run_skill_script** 执行（skill 填「Excel 表格（xlsx）」或 `agent-skill-xlsx`，script 填 `scripts/` 下相对路径）。
- LibreOffice（soffice）**未内置**：`recalc.py` 公式重算需要它——本机装有 LibreOffice 时可用（`scripts/office/soffice.py` 自动探测），未装时降级（见"重算公式"节）。
- 输出文件写到工作区目录并在回复中给出完整路径。

| 任务 | 做法 |
|---|---|
| **新建**/**编辑**（公式、格式） | `openpyxl`（python 工具内联代码）——见下方要点 |
| **批量数据**进出 | `pandas`（`read_excel`、`to_excel`） |
| **快速浏览**表 | `openpyxl` 读值遍历或 `pandas` 摘要；读取 `.xlsm` 同样支持 |
| **读取**模型（公式和值都要） | 两次 `load_workbook`——见要点 |

## 每个输出的要求

- **专业字体**（Arial、Times New Roman）贯穿全文，除非用户另有要求。
- **零公式错误。** 绝不在 `recalc.py` 报 `errors_found` 时交付。怀疑错误是原有的话先证明：用 `data_only=True` 加载*原文件*看那个单元格。
- **用公式，不要硬编码结果。** 写 `sheet['B10'] = '=SUM(B2:B9)'`，而不是 Python 算好的总数。输入变化时表格必须能重算。
- **严格照用户规格。** 表名、列头、用户说出的公式一字不差。算出别的东西的"美化重设计"算失败。
- **每个假设和硬编码数字都在读者看得到的地方注明**——单元格批注或表格末尾的相邻单元格。有真实来源就引用（`Source: Company 10-K, FY2024, Page 45`）；来自用户的数字就直说。
- **给人填的模板**（你新建的）需要简短图例说明哪些单元格可编辑，加一行符合预期格式的真实示例值。被要求编辑的文件绝不加这种行。
- **编辑已有文件：严格沿用它的约定。** 它压倒本页一切规范。先找它的指定输入单元格（字体颜色、填充或底纹标记），只写那里，已有公式一律不动。

## 重算公式（文件含公式时必须做；视 LibreOffice 而定）

openpyxl 把公式写成字符串，**没有缓存值**。重算之前，公式单元格对任何读缓存值的一方（`pandas`、`load_workbook(data_only=True)`、大多数预览器）读出来都是 `None`。

```bash
# 本机装有 LibreOffice 时，用 run_skill_script 执行（缺省 30 秒超时可传参）：
#   script: scripts/recalc.py, args: output.xlsx [timeout_seconds]
```

LibreOffice 计算全部公式，文件**原地重写**，输出 JSON：`status`（`success` | `errors_found`）、`total_formulas`、`total_errors`、`error_summary`（每类错误点名最多 100 个单元格，`locations_truncated` 说明截断数——以 `total_errors` 为准，别信数组长度）。修掉它点名的再跑。**JSON 带 `error` 键而非 `status` 表示什么都没重算**——只有这种情况退出码非零；`errors_found` 退出码是 0，所以干净退出 ≠ 干净工作簿。

**重算通过只证明公式*能求值*，不证明*正确*。** 差一行区间或引用错行会得到干净无错但数字错误的文件。先写 2-3 个公式验证取值符合预期，再铺开整片网格。

**链接了外部文件的簿**用 openpyxl 另存再重算会丢链接（`='[1]Returns Analysis'!$B$2` 的 `[1]` 是外部引用索引，指向磁盘上另一个文件）。`recalc.py` 会拒绝在这种状态下运行——先把那些单元格的值从原文件复制出来再另存（`--force` 可强制并接受丢失）。

### 没有 LibreOffice 时的降级

未检测到 soffice 时 `recalc.py` 返回 `{"error": "soffice not found..."}`——此时**跳过重算并明确告知用户**：公式以字符串写入、缓存值为空，Excel/WPS 打开后会自动计算，但依赖缓存值的工具（pandas 读取等）拿不到值。也可考虑用 python 工具内联代码为关键公式手动写入计算结果到相邻单元格并注明"缓存值，公式见原单元格"（仅在用户可接受时）。

## 选能通过校验的公式

LibreOffice 实现的函数比 Excel 少，一个它算不了的函数会变成烙进文件的字面 `#NAME?`。

- **优先 Excel 2007 时代的函数**——`SUMIFS`、`INDEX`、`MATCH`、`IFERROR`、`SUMPRODUCT`，无需前缀。
- **六个 2007 后函数可用，但必须带 `_xlfn.` 前缀**（openpyxl 原样写入你的公式，Excel 存储时对 2007 后函数名加前缀、UI 隐藏前缀）：`_xlfn.TEXTJOIN`、`_xlfn.CONCAT`、`_xlfn.IFS`、`_xlfn.SWITCH`、`_xlfn.MAXIFS`、`_xlfn.MINIFS`。裸写每个都变 `#NAME?`。
- **绝不用 `XLOOKUP`、`XMATCH`、`SORT`、`FILTER`、`UNIQUE`、`SEQUENCE`。** LibreOffice 任何前缀下都算不了它们；新版能算但它们是溢出数组函数，openpyxl 写的文件没有溢出元数据，只有区域左上角一个单元格有值——`recalc.py` 对截断结果报 `total_errors: 0`。查找用 `INDEX`/`MATCH`；排序、过滤、去重先用 Python 做完再写单元格。
- LibreOffice 解析不了的公式会被**小写**写回——`#NAME?` 旁边这是快速识别线索。

## openpyxl 要点

- **读模型要两次加载。** `data_only=True` 给缓存值但公式没了；默认给公式字符串但没值。一次加载拿不到两者。
- **`data_only=True` 后保存是破坏性的**——那份工作簿已无公式，保存会把每个公式永久替换成字面值。
- **`data_only=True` 读 openpyxl 刚写的文件全是 `None`**——先跑 `recalc.py`。（结果为 `""` 的公式也读成 `None`。）
- **合并单元格只写左上角锚点。** 区域内其他单元格是只读的 `MergedCell`。
- **`.xlsm` 不加 `keep_vba=True` 会丢宏**。
- **含空格的表名在跨表引用里必须加引号**：`='Assumptions Inputs'!$B$5`。不加引号求值为 `#VALUE!`。

## 金融模型

除非用户另有要求，或已有文件另做他用。

**颜色：** 硬编码输入与情景杠杆用蓝色文本（`0,0,255`）· 公式用黑色 · 跨表链接用绿色（`0,128,0`）· 跨文件链接用红色（`255,0,0`）· 关键假设与待填单元格用黄色填充（`255,255,0`）。

**数字：** 货币 `$#,##0`，表头注明单位（`Revenue ($mm)`）· 零显示为 `-`，百分比同理（`$#,##0;($#,##0);-`）· 负数加括号 · 百分比 `0.0%`，**按分数存**（`0.15` 显示 `15.0%`；存 `15` 显示 `1500.0%`）· 估值倍数 `0.0x` · 年份存文本（`"2024"`，绝不显示成 `2,024`）。

**结构：** 每个假设独占一个带标签的单元格，公式引用它（`=B5*(1+$B$6)`，绝不 `=B5*1.05`）· 公式在每个预测期保持一致（一行中间单改一个单元格是最常见的静默错误）· 可能为零的分母加保护。

## 依赖（均已内置或降级）

`openpyxl`、`pandas`、`numpy`、`lxml`、`defusedxml`（pip，已预装）· LibreOffice `soffice`（未内置，`recalc.py` 仅本机装有 LibreOffice 时可用）
