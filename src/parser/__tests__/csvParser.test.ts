import { describe, it, expect } from 'vitest';
import { parseCsvText } from '../csvParser';

describe('parseCsvText', () => {
  describe('raw format (日志原文)', () => {
    it('should parse MapArchiveUpload rows and extract archive_diff', () => {
      const csv = `日志时间,日志原文
2026-03-19 14:22:26.000,"Mar 19 14:22:26 up5-prod-7780 UP5_GameStatistic: [2026-03-19 14:22:26 +0800][MapArchiveUpload],{""game_server"":""game_3"",""archive_diff"":""|100=1>>>2""}"`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe('2026-03-19 14:22:26.000');
      expect(result[0].rawText).toBe('|100=1>>>2');
      expect(result[0].isClean).toBe(true);
    });

    it('should filter out non-MapArchiveUpload rows', () => {
      const csv = `日志时间,日志原文
2026-03-19 14:00:00.000,"[2026-03-19 14:00:00 +0800][Chat],{""msg"":""hello""}"
2026-03-19 14:01:00.000,"[2026-03-19 14:01:00 +0800][MapEvent],{""event"":""click""}"
2026-03-19 14:02:00.000,"[2026-03-19 14:02:00 +0800][MapArchiveUpload],{""archive_diff"":""|50=1>>>2""}"`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(1);
      expect(result[0].rawText).toBe('|50=1>>>2');
    });

    it('should handle empty CSV', () => {
      const csv = `日志时间,日志原文`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(0);
    });
  });

  describe('clean format (archive_diff)', () => {
    it('should parse cleaned CSV with archive_diff column directly', () => {
      const csv = `日志时间,archive_diff
2026-03-19 14:22:26.000,|100=1>>>2|200=nil>>>5`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe('2026-03-19 14:22:26.000');
      expect(result[0].rawText).toBe('|100=1>>>2|200=nil>>>5');
      expect(result[0].isClean).toBe(true);
    });

    it('preserves aid from cleaned archive_diff exports for recovery provenance', () => {
      const csv = `aid,nickname,log_time,archive_diff
30344223,player,2026-05-14 00:00:07,|100=1>>>2`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(1);
      expect(result[0].aid).toBe('30344223');
    });

    it('should handle cleaned CSV with multiple rows', () => {
      const csv = `日志时间,archive_diff
2026-03-19 13:00:00.000,|50=10>>>20
2026-03-19 14:00:00.000,|100=1>>>2`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(2);
    });

    it('should prefer per-row log_time over query window fields for archive_diff exports', () => {
      const csv = `aid,nickname,query_from,query_to,log_time,timestamp,archive_diff,raw_log
31203737,player,2026.05.14-00:00:00,2026.05.15-00:00:00,2026-05-14 00:00:07,1778688007,|100=1>>>2,raw-a
31203737,player,2026.05.14-00:00:00,2026.05.15-00:00:00,2026-05-14 00:00:32,1778688032,|100=2>>>3,raw-b`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(2);
      expect(result.map((row) => row.timestamp)).toEqual([
        '2026-05-14 00:00:07',
        '2026-05-14 00:00:32',
      ]);
    });
  });

  describe('real exported CSV variants', () => {
    it('parses raw archive_diff CSV with normal Chinese headers', () => {
      const csv = `日志时间,日志原文
2026-04-09 16:14:26.000,"Apr  9 16:14:26 up5-prod-7718 UP5_GameStatistic: [2026-04-09 16:14:26 +0800][MapArchiveUpload],{""archive_diff"":""|89-1=nil>>>100|""}"`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe('2026-04-09 16:14:26.000');
      expect(result[0].rawText).toBe('|89-1=nil>>>100|');
    });

    it('parses batch-check CSV with matched_log_raw', () => {
      const csv = `id,nickname,has_archive_change,hit_log_count,query_from,query_to,query_text,matched_log_raw,error_message
30085223,player,yes,1,2026.04.09-18:08:00,2026.04.09-19:20:00,q,"Apr  9 18:08:04 up5-prod UP5_GameStatistic: [2026-04-09 18:08:04 +0800][MapArchiveUpload],{""archive_diff"":""|90-2=1>>>2|""}",`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe('2026-04-09 18:08:00');
      expect(result[0].rawText).toBe('|90-2=1>>>2|');
    });

    it('preserves aid from raw MapArchiveUpload JSON for recovery provenance', () => {
      const csv = `日志时间,日志原文
2026-04-09 16:14:26.000,"Apr  9 16:14:26 up5-prod UP5_GameStatistic: [2026-04-09 16:14:26 +0800][MapArchiveUpload],{""aid"":""30344224"",""archive_diff"":""|89-1=nil>>>100|""}"`;
      const result = parseCsvText(csv);
      expect(result).toHaveLength(1);
      expect(result[0].aid).toBe('30344224');
    });
  });

});
