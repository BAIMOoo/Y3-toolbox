# 存档恢复工具

## 功能

从多玩家存档变动日志中提取问题时间后每个玩家每个字段的第一次变动，生成恢复清单。

## 使用方法

```bash
npm run recovery -- \
  --input "all_players_logs.csv" \
  --problem-time "2026-03-20 10:00:00" \
  --output-dir "./recovery-reports"
```

### 参数说明

- `--input, -i`: CSV 日志文件路径（必需）
- `--problem-time, -t`: 问题发生时间，格式 `YYYY-MM-DD HH:mm:ss`（必需）
- `--output-dir, -o`: 输出目录路径（必需）

### 输入文件格式

支持两种 CSV 格式：

1. **原始日志格式**：列 `日志时间`、`日志原文`（包含 JSON）
2. **清洗格式**：列 `日志时间`、`archive_diff`

日志中必须包含 `"aid"` 字段（玩家 ID）。缺少 aid 字段的日志条目会被自动跳过。

### 输出文件

生成两个文件：

1. **CSV 格式**：`recovery-YYYYMMDD-HHmmss.csv`
   - 用于批量导入恢复脚本
   - 列：玩家ID、存档键、出问题前的存档值、变动后值、变动时间、变动类型

2. **Markdown 格式**：`recovery-YYYYMMDD-HHmmss.md`
   - 用于人工审核
   - 按玩家分组，展示变动摘要和统计信息

## 核心逻辑

对于每个玩家的每个存档字段，取问题时间后**第一次变动**的 `oldValue` 作为"出问题前的存档值"。

## 示例

```bash
# 使用项目中的示例文件
npm run recovery -- \
  --input "archive_diff_export (32).csv" \
  --problem-time "2026-03-20 15:00:00" \
  --output-dir "./recovery-reports"
```

输出：
```
🚀 开始生成存档恢复清单...

📂 检查文件: archive_diff_export (32).csv
📂 读取文件: archive_diff_export (32).csv
⏰ 问题发生时间: 2026-03-20 15:00:00
🔍 解析 CSV 日志...
   找到 4176 条日志记录
👥 提取玩家日志...
   找到 1 个受影响玩家
🔎 分析每个玩家的第一次变动...
   总变动条目数: 2122

📁 创建输出目录: ./recovery-reports
💾 生成 CSV 文件: recovery-20260409-153636.csv
💾 生成 Markdown 文件: recovery-20260409-153636.md

✅ 恢复清单生成完成！

📊 统计信息:
   - 受影响玩家数: 1
   - 总变动条目数: 2122

📄 输出文件:
   - CSV: recovery-reports/recovery-20260409-153636.csv
   - Markdown: recovery-reports/recovery-20260409-153636.md
```

## 注意事项

1. **日志完整性**：确保日志中包含问题发生时间之前的记录
2. **人工审核**：生成的恢复清单需要人工审核后再执行恢复操作
3. **测试验证**：建议先在测试环境对 1-2 个玩家执行恢复，验证逻辑正确性
