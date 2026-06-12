#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { parseCsvText } from '../src/parser/csvParser';
import { extractPlayerLogs } from './recovery/extractPlayerLogs';
import { findFirstChanges } from './recovery/findFirstChanges';
import { generateCsv } from './recovery/generateCsv';
import { generateMarkdown } from './recovery/generateMarkdown';
import type { RecoveryReport } from './recovery/types';

// 启用 dayjs 自定义格式解析
dayjs.extend(customParseFormat);

const program = new Command();

program
  .name('recovery-tool')
  .version('1.0.0')
  .description('存档恢复清单生成工具')
  .requiredOption('-i, --input <path>', 'CSV 日志文件路径')
  .requiredOption('-t, --problem-time <time>', '问题发生时间 (格式: YYYY-MM-DD HH:mm:ss)')
  .requiredOption('-o, --output-dir <path>', '输出目录路径')
  .parse();

const options = program.opts<{
  input: string;
  problemTime: string;
  outputDir: string;
}>();

async function main() {
  try {
    console.log('🚀 开始生成存档恢复清单...\n');

    // Step 1: 验证输入文件存在
    console.log(`📂 检查文件: ${options.input}`);
    try {
      await access(options.input, constants.R_OK);
    } catch {
      throw new Error(`文件不存在或无法读取: ${options.input}`);
    }

    // Step 2: 读取 CSV 文件
    console.log(`📂 读取文件: ${options.input}`);
    const csvText = await readFile(options.input, 'utf-8');

    // Step 3: 解析问题时间
    const problemTime = dayjs(options.problemTime, 'YYYY-MM-DD HH:mm:ss', true);
    if (!problemTime.isValid()) {
      throw new Error(`无效的时间格式: ${options.problemTime}，请使用 YYYY-MM-DD HH:mm:ss 格式`);
    }
    console.log(`⏰ 问题发生时间: ${problemTime.format('YYYY-MM-DD HH:mm:ss')}`);

    // Step 4: 解析 CSV
    console.log('🔍 解析 CSV 日志...');
    const rows = parseCsvText(csvText);
    console.log(`   找到 ${rows.length} 条日志记录`);

    // Step 5: 提取玩家日志
    console.log('👥 提取玩家日志...');
    const playerLogsMap = extractPlayerLogs(rows, problemTime.toDate());
    console.log(`   找到 ${playerLogsMap.size} 个受影响玩家`);

    if (playerLogsMap.size === 0) {
      console.log('\n⚠️  未找到问题时间后的日志，请检查时间参数是否正确');
      process.exit(0);
    }

    // Step 6: 找第一次变动
    console.log('🔎 分析每个玩家的第一次变动...');
    const players = findFirstChanges(playerLogsMap);

    // Step 7: 构建报告
    const totalChanges = players.reduce(
      (sum, player) => sum + Object.keys(player.changes).length,
      0
    );

    const report: RecoveryReport = {
      problemTime: problemTime.toDate(),
      totalPlayers: players.length,
      totalChanges,
      players,
    };

    console.log(`   总变动条目数: ${totalChanges}`);

    // Step 8: 创建输出目录
    console.log(`\n📁 创建输出目录: ${options.outputDir}`);
    await mkdir(options.outputDir, { recursive: true });

    // Step 9: 生成文件名（使用统一的时间戳格式）
    const timestamp = dayjs().format('YYYYMMDD-HHmmss');
    const csvFilename = `recovery-${timestamp}.csv`;
    const mdFilename = `recovery-${timestamp}.md`;
    const csvPath = join(options.outputDir, csvFilename);
    const mdPath = join(options.outputDir, mdFilename);

    // Step 10: 生成并写入 CSV
    console.log(`💾 生成 CSV 文件: ${csvFilename}`);
    const csvContent = generateCsv(report);
    await writeFile(csvPath, csvContent, 'utf-8');

    // Step 11: 生成并写入 Markdown
    console.log(`💾 生成 Markdown 文件: ${mdFilename}`);
    const mdContent = generateMarkdown(report);
    await writeFile(mdPath, mdContent, 'utf-8');

    // Step 12: 完成
    console.log('\n✅ 恢复清单生成完成！');
    console.log(`\n📊 统计信息:`);
    console.log(`   - 受影响玩家数: ${report.totalPlayers}`);
    console.log(`   - 总变动条目数: ${report.totalChanges}`);
    console.log(`\n📄 输出文件:`);
    console.log(`   - CSV: ${csvPath}`);
    console.log(`   - Markdown: ${mdPath}`);
  } catch (error) {
    console.error('\n❌ 错误:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
